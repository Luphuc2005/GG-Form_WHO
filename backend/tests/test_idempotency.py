import uuid


def test_duplicate_same_uuid_same_payload_returns_existing(client):
    sub_uuid = str(uuid.uuid4())
    payload = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "pathology": {
                "selected": [
                    {"id": "serous_benign"}
                ]
            },
            "classification": "benign"
        }
    }

    # First request
    res1 = client.post("/api/v1/submissions", json=payload)
    assert res1.status_code == 201
    data1 = res1.json()

    # Second request with identical UUID & payload (e.g. network retry)
    res2 = client.post("/api/v1/submissions", json=payload)
    assert res2.status_code in (200, 201)
    data2 = res2.json()

    assert data1["submission_uuid"] == data2["submission_uuid"]
    assert data1["reference_code"] == data2["reference_code"]


def test_duplicate_same_uuid_different_payload_conflict_409(client):
    sub_uuid = str(uuid.uuid4())
    payload1 = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "pathology": {
                "selected": [{"id": "serous_benign"}]
            },
            "classification": "benign"
        }
    }

    payload2 = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "pathology": {
                "selected": [{"id": "serous_borderline"}]  # different selection!
            },
            "classification": "borderline"
        }
    }

    # First request succeeds
    res1 = client.post("/api/v1/submissions", json=payload1)
    assert res1.status_code == 201

    # Second request with same UUID but modified answers should trigger 409 Conflict
    res2 = client.post("/api/v1/submissions", json=payload2)
    assert res2.status_code == 409
    data2 = res2.json()
    assert data2["error"]["code"] == "IDEMPOTENCY_CONFLICT"
