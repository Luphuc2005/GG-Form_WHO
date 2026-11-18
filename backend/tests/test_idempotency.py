import uuid


def test_duplicate_same_uuid_same_payload_returns_existing(auth_client):
    sub_uuid = str(uuid.uuid4())
    payload = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "clinical_data": {"hospital_code": "TEST", "so_hs": sub_uuid, "encounter_code": "E1"},
            "pathology": {
                "selected": [
                    {"id": "serous_cystadenoma_8441_0"}
                ]
            },
            "classification": "benign"
        }
    }

    # First request
    res1 = auth_client.post("/api/v1/submissions", json=payload)
    assert res1.status_code == 201
    data1 = res1.json()

    # Second request with identical UUID & payload (e.g. network retry)
    res2 = auth_client.post("/api/v1/submissions", json=payload)
    assert res2.status_code in (200, 201)
    data2 = res2.json()

    assert data1["submission_uuid"] == data2["submission_uuid"]
    assert data1["reference_code"] == data2["reference_code"]


def test_duplicate_same_uuid_different_payload_conflict_409(auth_client):
    sub_uuid = str(uuid.uuid4())
    payload1 = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "clinical_data": {"hospital_code": "TEST", "so_hs": sub_uuid, "encounter_code": "E1"},
            "pathology": {
                "selected": [{"id": "serous_cystadenoma_8441_0"}]
            },
            "classification": "benign"
        }
    }

    payload2 = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "clinical_data": {"hospital_code": "TEST", "so_hs": sub_uuid, "encounter_code": "E1"},
            "pathology": {
                "selected": [{"id": "serous_borderline_8442_1"}]  # different selection!
            },
            "classification": "borderline"
        }
    }

    # First request succeeds
    res1 = auth_client.post("/api/v1/submissions", json=payload1)
    assert res1.status_code == 201

    # Second request with same UUID but modified answers should trigger 409 Conflict
    res2 = auth_client.post("/api/v1/submissions", json=payload2)
    assert res2.status_code == 409
    data2 = res2.json()
    assert data2["error"]["code"] == "IDEMPOTENCY_CONFLICT"
