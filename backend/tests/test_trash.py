"""Trash preserves record identity and keeps removed records out of active data."""
import io
import uuid

import pytest
from openpyxl import load_workbook
from sqlalchemy import func, select

from app.models.submission import Submission
from app.models.submission_event import SubmissionEvent
from tests.test_workflow import actors, act, complete, draft, save


def trash_change(client, headers, record, action):
    return client.post(
        f"/api/v1/records/{record['submission_uuid']}/{action}",
        headers=headers,
        json={"revision": record["revision"]},
    )


def test_trash_and_restore_keep_identity_history_and_exports(client, actors, db_session):
    owner = actors["trainee_a"]
    admin = actors["admin"]
    record = save(client, owner, draft(client, owner))
    record = act(client, owner, record, "submit").json()
    key = record["submission_uuid"]
    code = record["study_code"]
    original = db_session.get(Submission, record["id"])
    encounter_key = original.encounter_key

    response = trash_change(client, admin, record, "trash")
    assert response.status_code == 200, response.text
    trashed = response.json()
    assert trashed["workflow_status"] == "trashed"
    assert trashed["trashed_from_state"] == "submitted"
    assert trashed["trashed_at"] and trashed["sync_status"] == "pending"
    assert trashed["answers"] == record["answers"] and trashed["study_code"] == code
    assert db_session.get(Submission, record["id"]).encounter_key == encounter_key
    assert client.get("/api/v1/records", headers=admin).json()["total"] == 0
    assert client.get("/api/v1/records?state=trashed", headers=admin).json()["items"][0]["submission_uuid"] == key
    stats = client.get("/api/v1/admin/statistics", headers=admin).json()
    assert stats["total_submissions"] == 0 and "trashed" not in stats["by_workflow"]
    assert client.get("/api/v1/admin/submissions", headers=admin).json()["total"] == 0
    assert code not in client.get("/api/v1/admin/export.csv", headers=admin).text
    workbook = load_workbook(io.BytesIO(client.get("/api/v1/admin/export.xlsx", headers=admin).content))
    assert workbook.active.max_row == 1

    assert trash_change(client, admin, record, "trash").json()["revision"] == trashed["revision"]
    restored = trash_change(client, admin, trashed, "restore")
    assert restored.status_code == 200, restored.text
    restored = restored.json()
    assert restored["workflow_status"] == "submitted" and restored["trashed_at"] is None
    assert restored["trashed_from_state"] is None and restored["sync_status"] == "pending"
    assert restored["study_code"] == code and restored["answers"] == record["answers"]
    assert trash_change(client, admin, trashed, "restore").json()["revision"] == restored["revision"]
    assert client.get("/api/v1/records?state=trashed", headers=admin).json()["total"] == 0
    assert client.get("/api/v1/records", headers=owner).json()["total"] == 1
    assert client.get("/api/v1/admin/statistics", headers=admin).json()["total_submissions"] == 1
    assert code in client.get("/api/v1/admin/export.csv", headers=admin).text
    workbook = load_workbook(io.BytesIO(client.get("/api/v1/admin/export.xlsx", headers=admin).content))
    assert workbook.active.max_row == 2
    events = client.get(f"/api/v1/records/{key}/history", headers=admin).json()
    assert [event["action"] for event in events[:2]] == ["restore", "trash"]
    assert all(event["actor"] == "admin" for event in events[:2])
    assert db_session.scalar(select(func.count(Submission.id))) == 1


@pytest.mark.parametrize("state", ["draft", "changes_requested", "approved", "cancelled"])
def test_restore_returns_to_the_original_workflow_state(client, actors, db_session, state):
    record = draft(client, actors["trainee_a"])
    sub = db_session.get(Submission, record["id"])
    sub.workflow_status = state
    db_session.commit()
    record = client.get(f"/api/v1/records/{record['submission_uuid']}", headers=actors["admin"]).json()
    trashed = trash_change(client, actors["physician"], record, "trash").json()
    restored = trash_change(client, actors["physician"], trashed, "restore").json()
    assert restored["workflow_status"] == state
    assert restored["submission_uuid"] == record["submission_uuid"]


def test_trash_permissions_and_stale_edits(client, actors):
    owner = actors["trainee_a"]
    admin = actors["admin"]
    record = draft(client, owner)
    path = f"/api/v1/records/{record['submission_uuid']}"
    assert trash_change(client, {}, record, "trash").status_code == 401
    assert trash_change(client, owner, record, "trash").status_code == 403
    assert client.get("/api/v1/records?state=trashed", headers=owner).status_code == 403
    updated = save(client, owner, record)
    assert trash_change(client, admin, record, "trash").status_code == 409
    trashed = trash_change(client, admin, updated, "trash").json()
    assert client.get(path, headers=owner).status_code == 404
    assert client.put(path, headers=admin, json={"revision": trashed["revision"], "answers": complete(updated)}).status_code == 404
    assert act(client, admin, trashed, "submit").status_code == 404
    assert trash_change(client, owner, trashed, "restore").status_code == 403
    assert trash_change(client, admin, updated, "restore").status_code == 409
    restored = trash_change(client, admin, trashed, "restore").json()
    saved = save(client, owner, restored, complete(restored, ca_125="35"))
    assert trash_change(client, admin, trashed, "restore").status_code == 409
    assert client.get(path, headers=admin).json()["revision"] == saved["revision"]


def test_public_draft_is_unavailable_until_restored(client, actors):
    headers = {"X-Draft-Key": uuid.uuid4().hex * 2}
    body = {"submission_uuid": str(uuid.uuid4()), "form_version": 1}
    record = client.post("/api/v1/public/records", headers=headers, json=body).json()
    trashed = trash_change(client, actors["admin"], record, "trash").json()
    path = f"/api/v1/public/records/{record['submission_uuid']}"
    assert client.get(path, headers=headers).status_code == 404
    assert client.post("/api/v1/public/records", headers=headers, json=body).status_code == 404
    assert client.put(path, headers=headers, json={"revision": record["revision"], "answers": complete(record)}).status_code == 404
    assert client.post(path + "/submit", headers=headers, json={"revision": record["revision"]}).status_code == 404
    restored = trash_change(client, actors["admin"], trashed, "restore").json()
    assert client.get(path, headers=headers).json()["revision"] == restored["revision"]


def test_resync_retries_trashed_records_even_without_previous_confirmation(client, actors, db_session):
    record = draft(client, actors["trainee_a"])
    trashed = trash_change(client, actors["admin"], record, "trash").json()
    sub = db_session.get(Submission, record["id"])
    sub.sync_status = "not_configured"
    assert sub.synced_revision is None
    db_session.commit()
    response = client.post("/api/v1/admin/google-sheets/resync", headers=actors["admin"])
    assert response.status_code == 200 and response.json()["count"] == 1
    db_session.refresh(sub)
    assert sub.sync_status == "pending"
    assert client.post(f"/api/v1/records/{trashed['submission_uuid']}/retry-sync", headers=actors["admin"]).status_code == 200
