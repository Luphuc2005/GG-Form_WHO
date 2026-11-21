def test_health_live(client):
    response = client.get("/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["check"] == "live"


def test_health_ready(client):
    response = client.get("/health/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["database"] == "connected"
    assert data["schema_revision"] == "010_search_indexes"


def test_readiness_rejects_old_schema_without_exposing_database_details(client, db_session):
    from sqlalchemy import text
    db_session.execute(text("UPDATE alembic_version SET version_num='005_form_management'"))
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["database"] == "not_ready"
    assert "migration" in response.json()["message"]
    assert "DATABASE_URL" not in response.text


def test_readiness_rejects_missing_table_even_when_revision_was_stamped(client, db_session):
    from sqlalchemy import text
    db_session.execute(text("ALTER TABLE export_jobs RENAME TO export_jobs_missing"))
    try:
        response = client.get("/health/ready")
        assert response.status_code == 503
    finally:
        db_session.execute(text("ALTER TABLE export_jobs_missing RENAME TO export_jobs"))
