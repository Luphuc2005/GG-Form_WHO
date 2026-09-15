import uuid


def test_submit_basic_valid_response(client):
    sub_uuid = str(uuid.uuid4())
    payload = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "pathology": {
                "selected": [
                    {
                        "id": "serous_carcinoma_high_grade",
                        "children": [
                            {"id": "mucinous_benign"}
                        ]
                    }
                ]
            },
            "classification": "malignant"
        }
    }

    response = client.post("/api/v1/submissions", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["submission_uuid"] == sub_uuid
    assert data["form_version"] == 1
    assert data["status"] == "success"
    assert "reference_code" in data


def test_child_without_parent_rejected(client):
    sub_uuid = str(uuid.uuid4())
    # Submitting a child ('mucinous_benign') as a root selection without its parent
    payload = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "pathology": {
                "selected": [
                    {"id": "mucinous_benign"}
                ]
            },
            "classification": "benign"
        }
    }

    response = client.post("/api/v1/submissions", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "VALIDATION_ERROR"


def test_unrecognized_field_rejected(client):
    sub_uuid = str(uuid.uuid4())
    payload = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "pathology": {
                "selected": [
                    {"id": "completely_fake_tumor_id"}
                ]
            },
            "classification": "benign"
        }
    }

    response = client.post("/api/v1/submissions", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "VALIDATION_ERROR"


def test_invalid_form_version_rejected(client):
    sub_uuid = str(uuid.uuid4())
    payload = {
        "submission_uuid": sub_uuid,
        "form_version": 9999,  # non-existent
        "answers": {
            "pathology": {
                "selected": [{"id": "serous_benign"}]
            },
            "classification": "benign"
        }
    }

    response = client.post("/api/v1/submissions", json=payload)
    assert response.status_code == 404
    data = response.json()
    assert data["error"]["code"] == "NOT_FOUND"


def test_required_classification_missing(client):
    sub_uuid = str(uuid.uuid4())
    payload = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "pathology": {
                "selected": [{"id": "serous_benign"}]
            },
            "classification": ""  # empty
        }
    }

    response = client.post("/api/v1/submissions", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "VALIDATION_ERROR"


def test_other_selected_without_text_rejected(client):
    sub_uuid = str(uuid.uuid4())
    payload = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "pathology": {
                "selected": [
                    {
                        "id": "yolk_sac_tumor",
                        "children": [
                            {"id": "pathology_other"}
                        ]
                    }
                ],
                "other_text": ""  # empty but other selected
            },
            "classification": "malignant"
        }
    }

    response = client.post("/api/v1/submissions", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "VALIDATION_ERROR"


def test_other_not_selected_with_text_rejected(client):
    sub_uuid = str(uuid.uuid4())
    payload = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "pathology": {
                "selected": [{"id": "serous_benign"}],
                "other_text": "Unexpected text without selecting Khác"
            },
            "classification": "benign"
        }
    }

    response = client.post("/api/v1/submissions", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "VALIDATION_ERROR"


def test_admin_flow_and_csv_export(client):
    # 1. Login
    login_res = client.post("/api/v1/admin/login", json={"username": "admin", "password": "AdminTest123!"})
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Get statistics
    stats_res = client.get("/api/v1/admin/statistics", headers=headers)
    assert stats_res.status_code == 200

    # 3. Export CSV
    csv_res = client.get("/api/v1/admin/export.csv", headers=headers)
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers["content-type"]
    content = csv_res.content.decode("utf-8-sig")  # strip BOM
    assert "submission_uuid" in content
    assert "gpb_serous_carcinoma_high_grade" in content
