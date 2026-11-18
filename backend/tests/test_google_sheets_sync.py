"""Reconciliation contract tests; no requests are sent to a real spreadsheet."""
import io
import json
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.services import google_sheets_svc as sync
from app.services.export_svc import FORM_COLUMNS


class FakeResponse(io.BytesIO):
    def __init__(self, body, content_type):
        super().__init__(body)
        self.status = 200
        self.headers = {"Content-Type": content_type}


class FakeSheet:
    """Model the authenticated Apps Script webhook."""
    def __init__(self):
        self.headers = [label for _, label in FORM_COLUMNS]
        self.rows = []
        self.posts = []
        self.fail_at = None
        self.snapshot_available = True
        self.ignore_writes = False

    def open(self, request, timeout):
        assert request.get_method() == "POST"
        payload = json.loads(request.data)
        if payload.get("token") != "synthetic-token" or payload.get("spreadsheet_id") != "test-sheet":
            return FakeResponse(b'{"status":"unauthorized"}', "application/json")
        if payload.get("action") == "snapshot":
            if not self.snapshot_available:
                return FakeResponse(b'{"status":"error"}', "application/json")
            rows = [[str(cell) if cell is not None else "" for cell in row]
                    for row in [self.headers, *self.rows]]
            return FakeResponse(json.dumps({"status": "snapshot", "rows": rows}).encode(), "application/json")
        self.posts.append(payload)
        if self.fail_at == len(self.posts):
            return FakeResponse(b'{"status":"error","message":"appendRow failed"}', "application/json")
        if not self.ignore_writes:
            self.rows.append(payload["row"])
        return FakeResponse(b'{"status":"success"}', "application/json")


class GoogleSheetsSyncTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session = sessionmaker(bind=self.engine, expire_on_commit=False)()
        self.sheet = FakeSheet()
        self.patchers = [
            patch.object(sync, "settings", SimpleNamespace(
                GOOGLE_SHEETS_WEBHOOK_URL="https://example.invalid/webhook",
                GOOGLE_SHEETS_SPREADSHEET_ID="test-sheet",
                GOOGLE_SHEETS_WEBHOOK_TOKEN="synthetic-token",
            )),
            patch.object(sync.urllib.request, "urlopen", side_effect=self.sheet.open),
        ]
        for patcher in self.patchers:
            patcher.start()
        self.submissions = []
        # Dashboard totals include both versions, including an older unpublished one.
        for version in (1, 2):
            form = FormVersion(
                form_key="ovarian-pathology-who", version=version,
                status="archived" if version == 1 else "published",
                schema_hash=str(version),
                schema_json={"form_key": "ovarian-pathology-who", "version": version,
                             "title": "Test form", "fields": []},
            )
            self.session.add(form)
            self.session.flush()
            sub = Submission(
                submission_uuid=uuid.uuid4(), form_version_id=form.id,
                payload_hash="test", classification="benign", workflow_status="approved",
                answers={"pathology": {"selected": []}, "clinical_data": {}},
            )
            self.session.add(sub)
            self.submissions.append(sub)
        self.session.commit()

    def tearDown(self):
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.session.close()
        self.engine.dispose()

    def test_missing_rows_across_versions_are_added_once(self):
        self.sheet.rows.append(sync._submission_row(self.submissions[0])[1])
        result = sync.resync_all_to_google_sheets(self.session)
        self.assertEqual(result, {"status": "success", "count": len(self.submissions),
                                  "added_count": len(self.submissions) - 1, "verified": True})
        self.assertEqual({row[0] for row in self.sheet.rows},
                         {str(sub.submission_uuid) for sub in self.submissions})
        posts_before = len(self.sheet.posts)
        again = sync.resync_all_to_google_sheets(self.session)
        self.assertEqual(again["added_count"], 0)
        self.assertEqual(len(self.sheet.posts), posts_before)
        self.assertTrue(all("rows" not in payload for payload in self.sheet.posts))

    def test_trimmed_hospital_sheet_keeps_its_headers_during_resync(self):
        study_labels = {"Mã nghiên cứu", "Giai đoạn nghiên cứu", "Bệnh viện trung tâm ung thư (1/0)"}
        self.sheet.headers = [label for label in self.sheet.headers if label not in study_labels]
        result = sync.resync_all_to_google_sheets(self.session)
        self.assertEqual(result["status"], "success")
        self.assertTrue(all(post["headers"] == self.sheet.headers for post in self.sheet.posts))
        self.assertTrue(all(len(row) == len(self.sheet.headers) for row in self.sheet.rows))

    def test_http_200_application_error_is_not_success(self):
        self.sheet.fail_at = 1
        result = sync.resync_all_to_google_sheets(self.session)
        self.assertEqual(result["status"], "error")
        self.assertEqual(self.sheet.rows, [])
        self.assertNotIn("verified", result)

    def test_silent_webhook_success_requires_readback(self):
        self.sheet.ignore_writes = True
        result = sync.resync_all_to_google_sheets(self.session)
        self.assertEqual(result["status"], "error")
        self.assertNotIn("count", result)

    def test_retry_after_partial_failure_does_not_duplicate(self):
        self.sheet.fail_at = 2
        self.assertEqual(sync.resync_all_to_google_sheets(self.session)["status"], "error")
        self.assertEqual(len(self.sheet.rows), 1)
        self.sheet.fail_at = None
        result = sync.resync_all_to_google_sheets(self.session)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["added_count"], len(self.submissions) - 1)
        self.assertEqual(len(self.sheet.rows), len(self.submissions))

    def test_unreadable_sheet_is_rejected_before_writing(self):
        self.sheet.snapshot_available = False
        self.assertEqual(sync.resync_all_to_google_sheets(self.session)["status"], "error")
        self.assertEqual(self.sheet.posts, [])

    def test_mismatched_columns_are_rejected_before_writing(self):
        self.sheet.headers = ["wrong header"]
        self.assertEqual(sync.resync_all_to_google_sheets(self.session)["status"], "error")
        self.assertEqual(self.sheet.posts, [])

    def test_extra_remote_rows_are_preserved_and_reported(self):
        extra_uuid = str(uuid.uuid4())
        self.sheet.rows.append([extra_uuid])
        result = sync.resync_all_to_google_sheets(self.session)
        self.assertEqual(result["status"], "error")
        self.assertIn(extra_uuid, [row[0] for row in self.sheet.rows])

    def test_duplicate_remote_rows_are_reported(self):
        row = sync._submission_row(self.submissions[0])[1]
        self.sheet.rows.extend([row, row])
        result = sync.resync_all_to_google_sheets(self.session)
        self.assertEqual(result["status"], "error")
        self.assertIn("1 dòng trùng", result["message"])

    def test_missing_configuration_does_not_write(self):
        sync.settings.GOOGLE_SHEETS_SPREADSHEET_ID = None
        self.assertEqual(sync.resync_all_to_google_sheets(self.session)["status"], "error")
        self.assertEqual(self.sheet.posts, [])

    def test_invalid_webhook_token_blocks_reconciliation(self):
        sync.settings.GOOGLE_SHEETS_WEBHOOK_TOKEN = "incorrect"
        self.assertEqual(sync.resync_all_to_google_sheets(self.session)["status"], "error")
        self.assertEqual(self.sheet.posts, [])

    def test_admin_api_queues_jobs_without_claiming_remote_success(self):
        from app.api.v1 import admin
        result = admin.resync_google_sheets(db=self.session, _=None)
        self.assertEqual(result, {"status": "queued", "count": 2})
        self.assertEqual(self.sheet.posts, [])
        self.session.expire_all()
        self.assertTrue(all(sub.sync_status == "pending" for sub in self.submissions))

    def test_empty_database_resync_reports_old_remote_rows_instead_of_success(self):
        from app.api.v1 import admin
        self.sheet.rows.append(sync._submission_row(self.submissions[0])[1])
        for sub in self.submissions:
            self.session.delete(sub)
        self.session.commit()
        result = admin.resync_google_sheets(db=self.session, _=None)
        self.assertEqual(result["count"], 0)
        self.assertEqual(result["sheet_extra_count"], 1)
        self.assertIn("chưa được xóa", result["warning"])
        self.assertEqual(self.sheet.posts, [])
        self.assertEqual(len(self.sheet.rows), 1)

    def test_read_error_is_reported_without_losing_queued_records(self):
        from app.api.v1 import admin
        self.sheet.snapshot_available = False
        result = admin.resync_google_sheets(db=self.session, _=None)
        self.assertEqual(result["count"], 2)
        self.assertIn("Chưa đối chiếu", result["warning"])
        self.assertIsNone(result["sheet_extra_count"])
        self.assertEqual(self.sheet.posts, [])


if __name__ == "__main__":
    unittest.main()
