import csv
import io
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
                        "id": "hgsc_8461_3",
                        "children": []
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
    # The published WHO catalog contains leaves; arbitrary child nodes are invalid.
    payload = {
        "submission_uuid": sub_uuid,
        "form_version": 1,
        "answers": {
            "pathology": {
                "selected": [
                    {"id": "hgsc_8461_3", "children": [{"id": "invalid_child"}]}
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
                "selected": [{"id": "serous_cystadenoma_8441_0"}]
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
                "selected": [{"id": "serous_cystadenoma_8441_0"}]
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
                        "id": "pathology_other",
                        "children": []
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
                "selected": [{"id": "serous_cystadenoma_8441_0"}],
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
    headers_row = next(csv.reader(io.StringIO(content)))
    assert "Mã phiếu" in headers_row
    assert "PARA" in headers_row
    assert "Phân loại Giải phẫu bệnh theo WHO" in headers_row


def test_clinical_record_is_available_in_admin_and_csv(client):
    sub_uuid = str(uuid.uuid4())
    clinical = {"so_hs": "0001", "ho_ten": "Test patient", "nam_sinh": "2000",
                "tuoi_phau_thuat": "26", "para": "0000"}
    response = client.post("/api/v1/submissions", json={
        "submission_uuid": sub_uuid, "form_version": 1,
        "answers": {"pathology": {"selected": [{"id": "hgsc_8461_3"}]},
                    "classification": "malignant", "clinical_data": clinical},
    })
    assert response.status_code == 201
    login = client.post("/api/v1/admin/login", json={"username": "admin", "password": "AdminTest123!"})
    headers = {"Authorization": "Bearer " + login.json()["access_token"]}
    items = client.get("/api/v1/admin/submissions", headers=headers).json()["items"]
    item = next(item for item in items if item["submission_uuid"] == sub_uuid)
    assert item["so_hs"] == clinical["so_hs"]
    assert item["ho_ten"] == clinical["ho_ten"]
    detail = client.get(f"/api/v1/admin/submissions/{item['id']}", headers=headers).json()
    assert detail["answers"]["clinical_data"] == clinical
    exported = client.get("/api/v1/admin/export.csv", headers=headers)
    rows = list(csv.DictReader(io.StringIO(exported.content.decode("utf-8-sig"))))
    row = next(row for row in rows if row["Mã phiếu"] == sub_uuid)
    assert row["Số HS"] == "'0001"
    assert row["PARA"] == "'0000"
    assert "HGSC" in row["Phân loại Giải phẫu bệnh theo WHO"]
