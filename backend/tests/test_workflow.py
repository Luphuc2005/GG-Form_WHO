"""Episode workflow, ownership, retry and data-quality regression tests."""
import uuid
import pytest
from sqlalchemy import select, func
from app.models.admin_user import AdminUser
from app.models.submission import Submission
from app.models.submission_event import SubmissionEvent
from app.core.security import create_access_token, hash_password

TEST_HASH = hash_password("SyntheticTest123!")


@pytest.fixture
def actors(db_session):
    result = {}
    for name, role in (("trainee_a", "intern"), ("trainee_b", "intern"), ("physician", "doctor")):
        user = AdminUser(username=name, role=role, password_hash=TEST_HASH)
        db_session.add(user)
        db_session.flush()
        result[name] = {"Authorization": "Bearer " + create_access_token({"sub": name})}
    db_session.commit()
    result["admin"] = {"Authorization": "Bearer " + create_access_token({"sub": "admin"})}
    return result


def draft(client, headers, key=None):
    response = client.post("/api/v1/records", headers=headers, json={"submission_uuid": key or str(uuid.uuid4()), "form_version": 1})
    assert response.status_code == 201, response.text
    return response.json()


def complete(record, **clinical):
    return {"pathology": {"selected": [{"id": "hgsc_8461_3"}]}, "classification": "benign",
            "clinical_data": {"hospital_code": "TD", "study_phase": "R", "so_hs": record["submission_uuid"], "treatment_date": "2026-01-01", **clinical}}


def save(client, headers, record, answers=None):
    response = client.put(f"/api/v1/records/{record['submission_uuid']}", headers=headers,
                          json={"revision": record["revision"], "answers": answers or complete(record)})
    assert response.status_code == 200, response.text
    return response.json()


def act(client, headers, record, action, note=""):
    return client.post(f"/api/v1/records/{record['submission_uuid']}/transition", headers=headers,
                       json={"revision": record["revision"], "action": action, "note": note})


def test_all_patient_endpoints_require_login(client):
    assert client.get("/api/v1/records").status_code == 401
    assert client.post("/api/v1/records", json={"submission_uuid": str(uuid.uuid4()), "form_version": 1}).status_code == 401
    assert client.post("/api/v1/submissions", json={"submission_uuid": str(uuid.uuid4()), "form_version": 1, "answers": {}}).status_code == 401


def test_dashboard_counts_all_records_but_sync_and_classification_only_sent(client, actors, db_session):
    doctor = actors["physician"]
    cases = [
        ("draft", "not_requested", "benign"),
        ("submitted", "synced", "benign"),
        ("approved", "pending", "malignant"),
        ("changes_requested", "failed", "unspecified"),
        ("cancelled", "synced", "borderline"),
    ]
    for state, sync, classification in cases:
        record = draft(client, doctor)
        row = db_session.get(Submission, record["id"])
        row.workflow_status = state
        row.sync_status = sync
        row.classification = classification
    db_session.commit()
    result = client.get("/api/v1/admin/statistics", headers=doctor)
    assert result.status_code == 200
    stats = result.json()
    assert stats["total_submissions"] == 3
    assert stats["today_submissions"] == 3
    assert stats["by_workflow"] == {state: 1 for state, _, _ in cases}
    assert stats["by_sync"] == {"synced": 1, "pending": 1, "failed": 1}
    assert stats["by_classification"] == {"benign": 1, "malignant": 1, "unspecified": 1}
    assert client.get("/api/v1/admin/statistics", headers=actors["trainee_a"]).status_code == 403


def test_ownership_and_role_boundaries(client, actors):
    a, b, doctor = actors["trainee_a"], actors["trainee_b"], actors["physician"]
    record = draft(client, a)
    path = f"/api/v1/records/{record['submission_uuid']}"
    assert client.get(path, headers=b).status_code == 404
    assert client.get(path+"/history", headers=b).status_code == 404
    assert client.put(path, headers=b, json={"revision": 1, "answers": complete(record)}).status_code == 404
    assert client.get("/api/v1/records", headers=b).json()["total"] == 0
    assert client.get(path, headers=doctor).status_code == 200
    assert act(client, a, record, "approve").status_code == 403
    for endpoint in ("/api/v1/admin/submissions", "/api/v1/admin/export.csv", "/api/v1/accounts"):
        assert client.get(endpoint, headers=a).status_code == 403
    assert client.post("/api/v1/accounts", headers=doctor, json={"username":"new_user", "password":"SyntheticPass123!"}).status_code == 403


def test_full_review_cycle_and_soft_cancel(client, actors, db_session):
    a, doctor = actors["trainee_a"], actors["physician"]
    record = save(client, a, draft(client, a))
    assert record["answers"]["classification"] == "malignant"  # Schema owns classification.
    assert act(client, a, record, "submit").status_code == 200
    submitted = client.get(f"/api/v1/records/{record['submission_uuid']}", headers=a).json()
    assert client.put(f"/api/v1/records/{record['submission_uuid']}", headers=a, json={"revision": submitted["revision"], "answers": complete(record)}).status_code == 409
    assert act(client, doctor, submitted, "return").status_code == 422
    returned = act(client, doctor, submitted, "return", "Đối chiếu đơn vị xét nghiệm").json()
    assert returned["workflow_status"] == "changes_requested"
    revised = save(client, a, returned, complete(record, ca_125="35.2"))
    submitted = act(client, a, revised, "submit").json()
    approved = act(client, doctor, submitted, "approve").json()
    assert approved["workflow_status"] == "approved"
    assert approved["sync_status"] == "pending"
    assert act(client, doctor, approved, "reopen", "Kiểm tra lại số hồ sơ").status_code == 200
    opened = client.get(f"/api/v1/records/{record['submission_uuid']}", headers=doctor).json()
    cancelled = act(client, doctor, opened, "cancel", "Phiếu nhập thử").json()
    assert cancelled["workflow_status"] == "cancelled"
    assert db_session.get(Submission, record["id"]) is not None
    assert client.get("/api/v1/admin/statistics", headers=doctor).json()["total_submissions"] == 0
    events = client.get(f"/api/v1/records/{record['submission_uuid']}/history", headers=a).json()
    assert {e["action"] for e in events} >= {"create", "save", "submit", "return", "approve", "reopen", "cancel"}
    assert next(e for e in events if e["action"] == "cancel")["note"] == "Phiếu nhập thử"
    assert any(e["before_answers"] and e["after_answers"] for e in events)


def test_retry_uses_one_record_and_one_submission_event(client, actors, db_session):
    a = actors["trainee_a"]
    key = str(uuid.uuid4())
    first = draft(client, a, key)
    assert draft(client, a, key)["id"] == first["id"]
    first = save(client, a, first)
    response = act(client, a, first, "submit")
    assert response.status_code == 200
    assert act(client, a, first, "submit").json()["revision"] == response.json()["revision"]
    assert db_session.scalar(select(func.count(SubmissionEvent.id)).where(SubmissionEvent.submission_id == first["id"], SubmissionEvent.action == "submit")) == 1


def test_stale_editor_cannot_overwrite_other_editor(client, actors):
    a = actors["trainee_a"]
    old = draft(client, a)
    new = save(client, a, old, complete(old, ca_125="12"))
    stale = client.put(f"/api/v1/records/{old['submission_uuid']}", headers=a, json={"revision": old["revision"], "answers": complete(old, ca_125="99")})
    assert stale.status_code == 409
    assert client.get(f"/api/v1/records/{old['submission_uuid']}", headers=a).json()["answers"] == new["answers"]


def test_one_episode_one_record_but_multiple_episodes_allowed(client, actors):
    a = actors["trainee_a"]
    first = draft(client, a)
    first = save(client, a, first, complete(first, so_hs="000123"))
    second = draft(client, a)
    response = client.put(f"/api/v1/records/{second['submission_uuid']}", headers=a,
        json={"revision": second["revision"], "answers": complete(second, so_hs="000123")})
    assert response.status_code == 409
    different = save(client, a, second, complete(second, so_hs="000123", treatment_date="2026-02-01"))
    assert different["id"] != first["id"]


def test_blank_new_draft_does_not_inherit_previous_patient(client, actors):
    a = actors["trainee_a"]
    first = draft(client, a)
    save(client, a, first, complete(first, ho_ten="SYNTHETIC", ca_125="123", mri_hach="Có"))
    second = draft(client, a)
    assert second["answers"]["clinical_data"] == {}
    assert second["answers"]["pathology"]["selected"] == []
    assert second["submission_uuid"] != first["submission_uuid"]


@pytest.mark.parametrize("clinical", [
    {"ca_125": -1}, {"ca_125": "nan"}, {"he4": "Infinity"}, {"roma": 101},
    {"nam_sinh": "2099"}, {"nam_sinh": "2000", "nam_kham": "1999"},
    {"mri_hach": "FAKE"}, {"para": "12"}, {"ca_125": []},
    {"ca_125": "35", "missing_reasons": {"ca_125": "not_done"}},
    {"missing_reasons": {"fake_field": "not_done"}},
    {"missing_reasons": {"he4": []}},
])
def test_invalid_clinical_values_rejected_on_server(client, actors, clinical):
    a = actors["trainee_a"]
    record = draft(client, a)
    response = client.put(f"/api/v1/records/{record['submission_uuid']}", headers=a,
        json={"revision": record["revision"], "answers": complete(record, **clinical)})
    assert response.status_code == 422, response.text


def test_partial_draft_can_be_saved_but_not_submitted(client, actors):
    a = actors["trainee_a"]
    record = draft(client, a)
    answers = {"clinical_data": {"ca_125": "35", "iota_benign": "60", "missing_reasons": {"he4": "not_done"}}}
    response = client.put(f"/api/v1/records/{record['submission_uuid']}", headers=a, json={"revision": record["revision"], "answers": answers})
    assert response.status_code == 200
    assert act(client, a, response.json(), "submit").status_code == 422


@pytest.mark.parametrize("values,expected", [
    ((10,20,15,15,20,20), 200),
    ((60,20,5,5,5,5), 200),
    ((16.6,16.6,16.7,16.7,16.7,16.7), 200),
    ((0.1,0.2,0.3,0.4,0.5,98.5), 200),
    ((100,0,0,0,0,0), 200),
    ((0,100,0,0,0,0), 200),
    ((60,40,10,10,10,10), 422),  # New study convention: total 140 is rejected.
    ((12,32,12,32,32,12), 422),  # User's screenshot: total 132.
    ((10,20,15,15,20,19.9), 422),
    ((10,20,15,15,20,20.1), 422),
    ((100,"","","","",""), 422),
    ((60,40,10,10,10,""), 422),
])
def test_six_percentages_must_total_100_for_study_entry(client, actors, values, expected):
    a = actors["trainee_a"]
    record = draft(client, a)
    fields = dict(zip(("iota_benign", "iota_malignant", "iota_borderline", "iota_stage1", "iota_stage2_4", "iota_metastatic"), values))
    record = save(client, a, record, complete(record, **fields))
    assert act(client, a, record, "submit").status_code == expected


def test_search_and_filters_cover_rows_beyond_first_page(client, actors, db_session):
    user = db_session.scalar(select(AdminUser).where(AdminUser.username == "trainee_a"))
    form_id = db_session.scalar(select(Submission.form_version_id))
    if form_id is None:
        from app.models.form_version import FormVersion
        form_id = db_session.scalar(select(FormVersion.id))
    for i in range(65):
        db_session.add(Submission(submission_uuid=uuid.uuid4(), form_version_id=form_id, payload_hash="synthetic", classification="benign", owner_id=user.id,
            workflow_status="submitted", answers={"clinical_data": {"so_hs": f"SEARCH-{i:03d}", "encounter_code": "E1"}}))
    db_session.commit()
    found = client.get("/api/v1/records?q=SEARCH-000&state=submitted", headers=actors["physician"]).json()
    assert found["total"] == 1 and found["items"][0]["so_hs"] == "SEARCH-000"
    legacy = client.get("/api/v1/admin/submissions?q=SEARCH-000", headers=actors["physician"]).json()
    assert legacy["total"] == 1
    assert client.get("/api/v1/records?q=SEARCH-000", headers=actors["trainee_b"]).json()["total"] == 0


def test_accounts_can_be_created_locked_and_do_not_grant_admin_rights(client, actors):
    created = client.post("/api/v1/accounts", headers=actors["admin"], json={"username": "new_trainee", "password": "SyntheticPass123!"})
    assert created.status_code == 201
    assert created.json()["role"] == "intern"
    login = client.post("/api/v1/admin/login", json={"username": "new_trainee", "password": "SyntheticPass123!"})
    assert login.status_code == 200
    token = {"Authorization": "Bearer " + login.json()["access_token"]}
    assert client.get("/api/v1/accounts/me", headers=token).json()["role"] == "intern"
    assert client.get("/api/v1/admin/submissions", headers=token).status_code == 403
    assert client.patch(f"/api/v1/accounts/{created.json()['id']}", headers=actors["admin"], json={"is_active": False}).status_code == 200
    assert client.get("/api/v1/accounts/me", headers=token).status_code == 401


def test_all_sent_records_are_exported_without_approval(client, actors):
    a, doctor = actors["trainee_a"], actors["physician"]
    record = save(client, a, draft(client, a))
    submitted = act(client, a, record, "submit").json()
    before = client.get("/api/v1/admin/export.csv", headers=doctor).text
    assert record["submission_uuid"] in before
    approved = act(client, doctor, submitted, "approve").json()
    after = client.get("/api/v1/admin/export.csv", headers=doctor).text
    assert record["submission_uuid"] in after
    act(client, doctor, approved, "cancel", "Duplicate confirmed")
    assert record["submission_uuid"] not in client.get("/api/v1/admin/export.csv", headers=doctor).text


def test_replaying_a_saved_draft_with_lost_response_does_not_conflict(client, actors):
    a = actors["trainee_a"]
    original = draft(client, a)
    answers = complete(original)
    stored = save(client, a, original, answers)
    replay = client.put(f"/api/v1/records/{original['submission_uuid']}", headers=a, json={"revision": original["revision"], "answers": answers})
    assert replay.status_code == 200 and replay.json()["revision"] == stored["revision"]


def test_vietnam_date_filter_is_converted_to_utc(client, actors, db_session):
    from datetime import datetime, timezone
    a = actors["trainee_a"]
    record = draft(client, a)
    sub = db_session.get(Submission, record["id"])
    sub.created_at = datetime(2026, 11, 17, 18, tzinfo=timezone.utc)  # 01:00 on 18th in Vietnam.
    db_session.commit()
    response = client.get("/api/v1/records", headers=a, params={"date_from":"2026-11-18T00:00:00+07:00", "date_to":"2026-11-18T23:59:59+07:00"})
    assert response.json()["total"] == 1


def test_other_diagnosis_can_be_drafted_before_detail_is_entered(client, actors):
    a = actors["trainee_a"]
    record = draft(client, a)
    answers = complete(record)
    answers["pathology"] = {"selected":[{"id":"pathology_other"}]}
    record = save(client, a, record, answers)
    assert act(client, a, record, "submit").status_code == 422


def test_legacy_delete_requires_reason_and_keeps_the_row(client, actors, db_session):
    record = draft(client, actors["trainee_a"])
    path = f"/api/v1/admin/submissions/{record['id']}"
    assert client.delete(path, headers=actors["physician"]).status_code == 422
    assert client.delete(path, headers=actors["physician"], params={"reason":"Synthetic cancelled record"}).status_code == 200
    db_session.expire_all()
    assert db_session.get(Submission, record["id"]).workflow_status == "cancelled"
