import logging
import csv
import io
import urllib.request
import urllib.parse
import urllib.error
import json
import threading
import time
import uuid
from collections import Counter
from sqlalchemy import select
from app.config import get_settings
from app.database import SessionLocal
from app.models.submission import Submission, EXPORTABLE_STATES
from app.schemas.form import FormSchemaDefinition
from app.services.export_svc import ExportService

settings = get_settings()
logger = logging.getLogger("google_sheets")
_sync_lock = threading.Lock()
_sheet_layout_version = 0
_sheet_layout_applied = False


class LegacyWebhookError(RuntimeError):
    """The deployed Apps Script only supports row writes and deletes."""


def _send_webhook(payload: dict, expected_status: str = "success") -> dict:
    """Apps Script can return HTTP 200 with an application-level error."""
    if not settings.GOOGLE_SHEETS_SPREADSHEET_ID:
        raise RuntimeError("Chưa cấu hình GOOGLE_SHEETS_SPREADSHEET_ID để đối chiếu phiếu trên Sheet.")
    if not settings.GOOGLE_SHEETS_WEBHOOK_TOKEN:
        raise RuntimeError("Chưa cấu hình GOOGLE_SHEETS_WEBHOOK_TOKEN.")
    body = {
        **payload,
        "token": settings.GOOGLE_SHEETS_WEBHOOK_TOKEN,
        "spreadsheet_id": settings.GOOGLE_SHEETS_SPREADSHEET_ID.strip(),
    }
    req = urllib.request.Request(
        settings.GOOGLE_SHEETS_WEBHOOK_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    timeout = 120 if expected_status == "batch_synced" else 60 if expected_status == "schema_updated" else 20
    with urllib.request.urlopen(req, timeout=timeout) as response:
        try:
            result = json.loads(response.read().decode("utf-8-sig"))
        except (ValueError, UnicodeError) as exc:
            raise RuntimeError("Google Sheets không trả về xác nhận JSON hợp lệ.") from exc
    if isinstance(result, dict) and result.get("status") == "unauthorized":
        raise RuntimeError("Token hoặc Spreadsheet ID không khớp với Script Properties của Apps Script.")
    if (isinstance(result, dict) and result.get("status") == "error"
            and ("appendRow()" in str(result.get("message", "")) or expected_status == "capabilities" and "Unsupported webhook action" in str(result.get("message", "")))
            and expected_status in ("snapshot", "schema_updated", "capabilities")):
        raise LegacyWebhookError("Apps Script đang chạy bản cũ. Cập nhật mã và triển khai Phiên bản mới của Web App để đồng bộ cột.")
    if not isinstance(result, dict) or result.get("status") != expected_status:
        raise RuntimeError("Google Sheets chưa xác nhận thao tác; kiểm tra bản triển khai Apps Script.")
    return result


def batch_capabilities():
    """Read headers/capabilities only, never clinical rows, for a modern webhook."""
    try:
        result = _send_webhook({"action": "capabilities"}, expected_status="capabilities")
    except LegacyWebhookError:
        return None
    if result.get("batch_version") != 1:
        return None
    headers = result.get("headers")
    if not isinstance(headers, list) or not all(isinstance(label, str) for label in headers):
        raise RuntimeError("Cấu trúc cột Sheet không hợp lệ.")
    return result


def _read_legacy_sheet_rows() -> list[list[str]]:
    """Use the existing readable CSV export when the old webhook has no snapshot action."""
    spreadsheet_id = urllib.parse.quote(settings.GOOGLE_SHEETS_SPREADSHEET_ID.strip(), safe="")
    url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv&gid=0&_sync={time.time_ns()}"
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    unavailable = "Apps Script đang chạy bản cũ và chưa đọc được Sheet để xác minh. Cập nhật mã và triển khai Phiên bản mới của Web App."
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            if "text/csv" not in response.headers.get("Content-Type", "").lower():
                raise RuntimeError(unavailable)
            return list(csv.reader(io.StringIO(response.read().decode("utf-8-sig"))))
    except urllib.error.HTTPError as error:
        raise RuntimeError(unavailable) from error


def _read_sheet_data() -> tuple[list[str], Counter, list[list[str]]]:
    """Read the configured sheet to verify UUIDs instead of trusting a sent count."""
    global _sheet_layout_version, _sheet_layout_applied
    _sheet_layout_version = 0
    _sheet_layout_applied = False
    try:
        result = _send_webhook({"action": "snapshot"}, expected_status="snapshot")
        _sheet_layout_version = int(result.get("layout_version", 0))
        _sheet_layout_applied = bool(result.get("layout_applied", False))
        rows = result.get("rows")
    except LegacyWebhookError:
        rows = _read_legacy_sheet_rows()
    if not isinstance(rows, list) or any(
        not isinstance(row, list) or not all(isinstance(cell, str) for cell in row)
        for row in rows
    ):
        raise RuntimeError("Google Sheets trả dữ liệu đối chiếu không hợp lệ.")
    if not rows:
        return [], Counter(), []
    counts: Counter = Counter()
    for row in rows[1:]:
        if not row or not any(cell.strip() for cell in row):
            continue
        try:
            key = str(uuid.UUID(row[0].strip()))
        except ValueError as exc:
            raise RuntimeError("Sheet có dòng không chứa mã phiếu UUID hợp lệ; chưa thể đối chiếu.") from exc
        counts[key] += 1
    return rows[0], counts, rows[1:]


def _read_sheet_snapshot() -> tuple[list[str], Counter]:
    headers, counts, _ = _read_sheet_data()
    return headers, counts


def _submission_row(sub: Submission) -> tuple[list[str], list]:
    from sqlalchemy.orm import object_session
    schema_def = FormSchemaDefinition.model_validate(sub.form_version.schema_json)
    db = object_session(sub)
    columns = ExportService.get_columns_for_database(db) if db is not None else ExportService.get_columns_from_schema(schema_def)
    label_map, code_map = ExportService._build_maps(schema_def)
    return (
        [str(col[2]) for col in columns],
        ExportService._flatten_submission_to_row(sub, columns, label_map, code_map),
    )


def fit_sheet_columns(existing_headers, export_headers, row):
    """Write only recognized columns already present in the destination sheet."""
    if not existing_headers:
        return export_headers, row
    legacy_uuid_header = existing_headers[0] == "Mã phiếu" and "ID đồng bộ" not in existing_headers and export_headers[0] == "ID đồng bộ"
    if legacy_uuid_header:
        positions = {label: i for i, label in enumerate(export_headers)}
        positions["Mã nghiên cứu"] = positions["Mã phiếu"]
        positions["Mã phiếu"] = positions["ID đồng bộ"]
        positions["Phân loại Giải phẫu bệnh theo WHO"] = positions["Kết quả giải phẫu bệnh WHO 1"]
        if len(set(existing_headers)) != len(existing_headers) or any(label not in positions for label in existing_headers):
            raise RuntimeError("Cấu trúc cột Sheet khác biểu mẫu xuất dữ liệu.")
        return existing_headers, [row[positions[label]] for label in existing_headers]
    if len(set(existing_headers)) != len(existing_headers) or not existing_headers or existing_headers[0] != export_headers[0]:
        raise RuntimeError("Cấu trúc cột Sheet không hợp lệ.")
    positions = {label: i for i, label in enumerate(export_headers)}
    if "Kết quả giải phẫu bệnh WHO 1" in positions:
        positions["Phân loại Giải phẫu bệnh theo WHO"] = positions["Kết quả giải phẫu bệnh WHO 1"]
    if any(label not in positions for label in existing_headers):
        raise RuntimeError("Cấu trúc cột Sheet khác biểu mẫu xuất dữ liệu.")
    return existing_headers, [row[positions[label]] for label in existing_headers]


def same_sheet_row(headers, expected, actual, numeric_labels=None, identifier_labels=None):
    """Allow Sheets' display normalization without losing identifier leading zeros."""
    from decimal import Decimal, InvalidOperation
    from app.services.clinical_validation import NUMBERS
    from app.services.export_svc import FORM_COLUMNS
    if numeric_labels is None:
        numeric_labels = {label for key, label in FORM_COLUMNS if key in NUMBERS}
    if identifier_labels is None:
        identifier_labels = {"Số HS", "PARA"}
    # CSV export omits trailing empty cells on some Sheets deployments.
    if len(actual) < len(expected):
        actual = list(actual) + [""] * (len(expected) - len(actual))
    if len(expected) != len(actual):
        return False
    for label, source, destination in zip(headers, expected, actual):
        source = "" if source is None else str(source)
        destination = "" if destination is None else str(destination)
        if source == destination:
            continue
        if label in identifier_labels and source.startswith("'") and source[1:] == destination:
            continue
        if label in numeric_labels and source and destination:
            try:
                left = Decimal(source.replace(",", "."))
                right = Decimal(destination.replace(",", "."))
                if left.is_finite() and right.is_finite() and left == right:
                    continue
            except InvalidOperation:
                pass
        return False
    return True


def _sync_worker(submission_id: int) -> None:
    webhook_url = settings.GOOGLE_SHEETS_WEBHOOK_URL
    if not webhook_url or not webhook_url.strip():
        return

    db = SessionLocal()
    try:
        stmt = select(Submission).where(Submission.id == submission_id)
        sub = db.scalars(stmt).first()
        if not sub or not sub.form_version or sub.workflow_status not in EXPORTABLE_STATES:
            return

        schema_def = FormSchemaDefinition.model_validate(sub.form_version.schema_json)
        columns = ExportService.get_columns_for_database(db)
        label_map, code_map = ExportService._build_maps(schema_def)
        row_data = ExportService._flatten_submission_to_row(sub, columns, label_map, code_map)

        # Build payload for Google Apps Script Webhook
        payload = {
            "headers": [str(col[2]) for col in columns],
            "keys": [str(col[0]) for col in columns],
            "row": row_data,
            "submission_uuid": str(sub.submission_uuid),
        }

        with _sync_lock:
            from app.services.form_sheet_sync import ensure_schema
            ensure_schema(db)
            if settings.GOOGLE_SHEETS_SPREADSHEET_ID:
                headers, existing = _read_sheet_snapshot()
                payload["headers"], payload["row"] = fit_sheet_columns(headers, payload["headers"], payload["row"])
                keys_by_label = {col[2]: col[0] for col in columns}
                payload["keys"] = [keys_by_label[label] for label in payload["headers"]]
                if str(sub.submission_uuid) in existing:
                    return
            _send_webhook(payload)
            logger.info("Google Sheets đã xác nhận nhận phiếu %s.", sub.submission_uuid)

    except Exception as e:
        logger.warning(f"Lưu ý: Không thể đồng bộ phiếu lên Google Sheets: {e}")
    finally:
        db.close()


def trigger_google_sheets_sync(submission_id: int) -> None:
    """Trigger background sync to Google Sheets without blocking user request."""
    if settings.GOOGLE_SHEETS_WEBHOOK_URL and settings.GOOGLE_SHEETS_WEBHOOK_URL.strip():
        thread = threading.Thread(target=_sync_worker, args=(submission_id,), daemon=True)
        thread.start()


def _delete_worker(submission_uuid: str) -> None:
    webhook_url = settings.GOOGLE_SHEETS_WEBHOOK_URL
    if not webhook_url or not webhook_url.strip():
        return

    try:
        payload = {
            "action": "delete",
            "submission_uuid": submission_uuid,
        }
        with _sync_lock:
            _send_webhook(payload, expected_status="deleted")
        logger.info("Google Sheets đã xác nhận xóa phiếu %s.", submission_uuid)
    except Exception as e:
        logger.warning(f"Lưu ý: Không thể xóa dòng tương ứng trên Google Sheets: {e}")


def trigger_google_sheets_delete(submission_uuid: str) -> None:
    """Trigger background delete from Google Sheets without blocking."""
    if settings.GOOGLE_SHEETS_WEBHOOK_URL and settings.GOOGLE_SHEETS_WEBHOOK_URL.strip():
        thread = threading.Thread(target=_delete_worker, args=(submission_uuid,), daemon=True)
        thread.start()


def resync_all_to_google_sheets(db) -> dict:
    """Append missing UUIDs and verify the destination, preserving existing rows."""
    webhook_url = settings.GOOGLE_SHEETS_WEBHOOK_URL
    if not webhook_url or not webhook_url.strip():
        return {"status": "error", "message": "Chưa cấu hình GOOGLE_SHEETS_WEBHOOK_URL"}

    try:
        with _sync_lock:
            # The dashboard counts all versions, so reconciliation must do the same.
            from app.services.form_sheet_sync import ensure_schema
            ensure_schema(db)
            all_subs = db.scalars(select(Submission).where(Submission.workflow_status.in_(EXPORTABLE_STATES)).order_by(Submission.created_at.asc())).all()
            sheet_headers, existing = _read_sheet_snapshot()
            expected_uuids = {str(sub.submission_uuid) for sub in all_subs}
            added_count = 0
            for sub in all_subs:
                headers, row = _submission_row(sub)
                headers, row = fit_sheet_columns(sheet_headers, headers, row)
                key = str(sub.submission_uuid)
                if key in existing:
                    continue
                _send_webhook({"headers": headers, "row": row, "submission_uuid": key})
                existing[key] = 1
                added_count += 1

            _, actual = _read_sheet_snapshot()
            missing = expected_uuids - set(actual)
            extra = set(actual) - expected_uuids
            duplicates = sum(count - 1 for count in actual.values())
            if missing or extra or duplicates:
                raise RuntimeError(
                    f"Sheet chưa khớp CSDL: thiếu {len(missing)} phiếu, "
                    f"thừa {len(extra)} mã phiếu, {duplicates} dòng trùng."
                )
            logger.info("Đã đối chiếu %s phiếu trên Google Sheets; bổ sung %s phiếu.", len(actual), added_count)
            return {"status": "success", "count": len(actual), "added_count": added_count, "verified": True}
    except Exception as e:
        logger.warning(f"Lỗi đồng bộ Google Sheets: {e}")
        return {"status": "error", "message": str(e)}
