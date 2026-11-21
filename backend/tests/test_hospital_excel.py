"""Hospital tabs must partition exported records without altering their values."""
import io
import uuid
from collections import Counter
from openpyxl import load_workbook
from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.services.export_svc import ExportService
from tests.test_workflow import actors


TABS = ["Tổng hợp", "TD - Từ Dũ", "HV - Hùng Vương", "YD - ĐH Y Dược", "GD - Gia Định", "UB - Ung Bướu CS2"]


def test_excel_hospital_tabs_partition_records_and_preserve_literal_values(auth_client, db_session):
    form = db_session.query(FormVersion).first()
    cases = [(code, state) for code, state in zip(
        ["TD", "TD", "HV", "YD", "GD", "UB", " hv ", "", "LEGACY", "TD", "HV", "YD"],
        ["submitted", "approved", "changes_requested", *["submitted"]*6, "draft", "trashed", "cancelled"],
    )]
    for index, (code, state) in enumerate(cases):
        db_session.add(Submission(submission_uuid=uuid.uuid4(), form_version_id=form.id,
            answers={"clinical_data": {"hospital_code": code, "so_hs": f"000{index}", "para": "0000", "ho_ten": "=1+1"}},
            classification="benign", payload_hash=f"synthetic-{index}", workflow_status=state))
    db_session.commit()
    response = auth_client.get("/api/v1/admin/export.xlsx")
    assert response.status_code == 200
    workbook = load_workbook(io.BytesIO(response.content))
    assert workbook.sheetnames == [*TABS, "Khác - Chưa xác định"]
    headers = [cell.value for cell in workbook.active[1]]
    hospital_column = headers.index("Mã bệnh viện")
    record_column = headers.index("Số HS")
    para_column = headers.index("PARA")
    name_column = headers.index("Họ Tên")
    total = list(workbook.active.values)[1:]
    assert len(total) == 9
    assert {row[record_column] for row in total} == {f"000{i}" for i in range(9)}
    combined = []
    for code, tab in zip(["TD", "HV", "YD", "GD", "UB", None], workbook.sheetnames[1:]):
        sheet = workbook[tab]
        assert [cell.value for cell in sheet[1]] == headers
        actual = list(sheet.values)[1:]
        expected = [row for row in total if (
            str(row[hospital_column] or "").strip().upper() == code if code else
            str(row[hospital_column] or "").strip().upper() not in ("TD", "HV", "YD", "GD", "UB"))]
        assert actual == expected
        combined.extend(actual)
    assert Counter(combined) == Counter(total)
    for sheet in workbook:
        assert sheet.freeze_panes == "E2" and sheet.auto_filter.ref
        assert sheet["A1"].font.bold and sheet["A1"].alignment.wrap_text
        for row in list(sheet.rows)[1:]:
            assert row[record_column].value.startswith("000")
            assert row[record_column].number_format == "@"
            assert row[para_column].value == "0000"
            assert row[name_column].value == "=1+1" and row[name_column].data_type == "s"
    workbook.close()


def test_empty_excel_keeps_all_hospital_tabs_and_reports_unique_record_count(db_session):
    progress = []
    output = ExportService.xlsx_file(db_session, on_progress=progress.append)
    workbook = load_workbook(output)
    assert workbook.sheetnames == TABS
    assert all(sheet.max_row == 1 for sheet in workbook)
    assert progress == [0]
    workbook.close()


def test_queued_excel_download_includes_hospital_tabs(client, actors, db_session, monkeypatch, tmp_path):
    from tests.test_export_jobs import environment
    from tests.test_workflow import draft, save, complete, act
    from app.services import export_jobs
    factory, settings = environment(db_session, monkeypatch, tmp_path)
    record = draft(client, actors["trainee_a"])
    record = save(client, actors["trainee_a"], record, complete(record, hospital_code="UB"))
    record = act(client, actors["trainee_a"], record, "submit").json()
    job = client.post("/api/v1/admin/exports", headers=actors["admin"]).json()
    assert export_jobs.process_one(factory, settings)
    status = client.get(f"/api/v1/admin/exports/{job['id']}", headers=actors["admin"]).json()
    assert status["row_count"] == status["total_rows"] == 1
    download = client.get(status["download_url"], headers=actors["admin"])
    workbook = load_workbook(io.BytesIO(download.content))
    assert workbook.sheetnames == TABS
    assert workbook.active.max_row == workbook["UB - Ung Bướu CS2"].max_row == 2
    assert all(workbook[tab].max_row == 1 for tab in TABS[1:-1])
    assert record["study_code"] in [cell.value for cell in workbook["UB - Ung Bướu CS2"][2]]
    workbook.close()
