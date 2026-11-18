"""Two WHO slots, backward compatibility and separate export columns; fake data only."""
import csv
import io
import uuid
from copy import deepcopy
import pytest
from openpyxl import load_workbook
from app.models.submission import Submission
from app.services.google_sheets_svc import _submission_row

FIRST = "serous_cystadenoma_8441_0"
SECOND = "yolk_sac_tumor_9071_3"


def create(client):
    headers = {"X-Draft-Key": uuid.uuid4().hex*2}
    record = client.post("/api/v1/public/records",headers=headers,json={"submission_uuid":str(uuid.uuid4()),"form_version":1}).json()
    return record,headers


def save(client,record,headers,selected,other_text=None):
    return client.put(f"/api/v1/public/records/{record['submission_uuid']}",headers=headers,json={"revision":record["revision"],"answers":{
        "clinical_data":{"hospital_code":"YD","study_phase":"R","so_hs":record["submission_uuid"]},
        "pathology":{"selected":selected,"other_text":other_text},"classification":"malignant"}})


def submit(client,record,headers):
    return client.post(f"/api/v1/public/records/{record['submission_uuid']}/submit",headers=headers,json={"revision":record["revision"]})


def test_two_results_survive_submit_admin_edit_and_excel_csv_sheet_export(auth_client,db_session):
    c=auth_client;record,headers=create(c)
    selected=[{"id":SECOND,"slot":2},{"id":FIRST,"slot":1}]
    stored=save(c,record,headers,selected)
    assert stored.status_code == 200,stored.text
    record=stored.json()
    assert [node["slot"] for node in record["answers"]["pathology"]["selected"]] == [1,2]
    assert record["answers"]["classification"] == "benign"  # WHO 1 owns the primary classification.
    assert submit(c,record,headers).status_code == 200
    detail=c.get(f"/api/v1/records/{record['submission_uuid']}").json()
    changed=deepcopy(detail["answers"]);changed["clinical_data"]["ca_125"]="12"
    edited=c.put(f"/api/v1/records/{record['submission_uuid']}",json={"revision":detail["revision"],"answers":changed})
    assert edited.status_code == 200,edited.text
    assert len(edited.json()["answers"]["pathology"]["selected"]) == 2
    rows=list(csv.reader(io.StringIO(c.get("/api/v1/admin/export.csv").content.decode("utf-8-sig"))))
    i,j=rows[0].index("Kết quả giải phẫu bệnh WHO 1"),rows[0].index("Kết quả giải phẫu bệnh WHO 2")
    assert j==i+1 and "Serous" in rows[1][i] and "Yolk" in rows[1][j]
    workbook=load_workbook(io.BytesIO(c.get("/api/v1/admin/export.xlsx").content),read_only=True)
    xlsx=list(workbook.active.values)
    assert xlsx[0]==tuple(rows[0]) and xlsx[1][i]==rows[1][i] and xlsx[1][j]==rows[1][j]
    workbook.close()
    sub=db_session.get(Submission,record["id"])
    labels,values=_submission_row(sub)
    assert "Serous" in values[labels.index("Kết quả giải phẫu bệnh WHO 1")]
    assert "Yolk" in values[labels.index("Kết quả giải phẫu bệnh WHO 2")]


def test_existing_single_result_remains_who_one_and_second_is_optional(auth_client):
    c=auth_client;record,headers=create(c)
    result=save(c,record,headers,[{"id":FIRST}])
    assert result.status_code == 200
    assert result.json()["answers"]["pathology"]["selected"][0]["slot"] == 1
    assert submit(c,result.json(),headers).status_code == 200
    rows=list(csv.reader(io.StringIO(c.get("/api/v1/admin/export.csv").content.decode("utf-8-sig"))))
    assert rows[1][rows[0].index("Kết quả giải phẫu bệnh WHO 2")] == ""


@pytest.mark.parametrize("selected", [
    [{"id":FIRST,"slot":1},{"id":SECOND,"slot":1}],
    [{"id":FIRST,"slot":1},{"id":"unknown_result","slot":2}],
    [{"id":FIRST},{"id":SECOND},{"id":FIRST}],
])
def test_invalid_second_result_or_duplicate_slot_is_rejected(auth_client,selected):
    record,headers=create(auth_client)
    assert save(auth_client,record,headers,selected).status_code == 422


def test_who_two_without_who_one_can_be_drafted_but_not_submitted(auth_client):
    record,headers=create(auth_client)
    stored=save(auth_client,record,headers,[{"id":SECOND,"slot":2}])
    assert stored.status_code == 200
    assert stored.json()["answers"]["pathology"]["selected"][0]["slot"] == 2
    assert stored.json()["answers"]["classification"] == "unspecified"
    assert submit(auth_client,stored.json(),headers).status_code == 422


def test_each_other_result_needs_its_own_text(auth_client):
    c=auth_client;record,headers=create(c)
    selected=[{"id":"pathology_other","slot":1,"other_text":"SYNTHETIC WHO ONE"},{"id":"pathology_other","slot":2}]
    stored=save(c,record,headers,selected)
    assert stored.status_code == 200
    assert submit(c,stored.json(),headers).status_code == 422
    selected[1]["other_text"]="SYNTHETIC WHO TWO"
    stored=save(c,stored.json(),headers,selected)
    assert stored.status_code == 200
    assert submit(c,stored.json(),headers).status_code == 200
    rows=list(csv.reader(io.StringIO(c.get("/api/v1/admin/export.csv").content.decode("utf-8-sig"))))
    assert "SYNTHETIC WHO ONE" in rows[1][rows[0].index("Kết quả giải phẫu bệnh WHO 1")]
    assert "SYNTHETIC WHO TWO" in rows[1][rows[0].index("Kết quả giải phẫu bệnh WHO 2")]


def test_clear_second_result_preserves_first(auth_client):
    c=auth_client;record,headers=create(c)
    stored=save(c,record,headers,[{"id":FIRST,"slot":1},{"id":SECOND,"slot":2}]).json()
    changed=save(c,stored,headers,[{"id":FIRST,"slot":1}])
    assert changed.status_code == 200
    assert [node["id"] for node in changed.json()["answers"]["pathology"]["selected"]] == [FIRST]


def test_legacy_top_level_other_text_is_exported_only_in_who_one(auth_client):
    c=auth_client;record,headers=create(c)
    stored=save(c,record,headers,[{"id":"pathology_other"},{"id":SECOND}],other_text="SYNTHETIC LEGACY OTHER")
    assert stored.status_code == 200
    assert submit(c,stored.json(),headers).status_code == 200
    rows=list(csv.reader(io.StringIO(c.get("/api/v1/admin/export.csv").content.decode("utf-8-sig"))))
    assert "SYNTHETIC LEGACY OTHER" in rows[1][rows[0].index("Kết quả giải phẫu bệnh WHO 1")]
    assert "SYNTHETIC LEGACY OTHER" not in rows[1][rows[0].index("Kết quả giải phẫu bệnh WHO 2")]
