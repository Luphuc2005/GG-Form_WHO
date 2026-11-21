"""Preflight catches upgrade blockers without publishing forms or sending data."""
from types import SimpleNamespace
import pytest
from sqlalchemy import text, select, func
from app.commands.check_deployment import check
from app.models.form_version import FormVersion


def config(**values):
    return SimpleNamespace(GOOGLE_SHEETS_WEBHOOK_URL=values.get("url", ""),
        GOOGLE_SHEETS_SPREADSHEET_ID=values.get("sheet", ""), GOOGLE_SHEETS_WEBHOOK_TOKEN=values.get("token", ""))


def test_preflight_accepts_known_old_migration_without_modifying_form(db_session):
    db_session.execute(text("UPDATE alembic_version SET version_num='005_form_management'"))
    original = db_session.scalar(select(func.count()).select_from(FormVersion))
    report = check(db_session, config(), before_migration=True)
    assert report["migration_needed"] and report["database_revision"] == "005_form_management"
    assert db_session.scalar(select(func.count()).select_from(FormVersion)) == original
    with pytest.raises(RuntimeError, match="migration"):
        check(db_session, config())


def test_preflight_rejects_unversioned_existing_database(db_session):
    db_session.execute(text("DELETE FROM alembic_version"))
    with pytest.raises(RuntimeError, match="Alembic"):
        check(db_session, config(), before_migration=True)


def test_preflight_rejects_partial_sheet_config_and_dev_url(db_session):
    with pytest.raises(RuntimeError, match="token"):
        check(db_session, config(url="https://script.google.com/macros/s/synthetic/exec", sheet="synthetic"))
    with pytest.raises(RuntimeError, match="/exec"):
        check(db_session, config(url="https://script.google.com/macros/s/synthetic/dev", sheet="synthetic", token="synthetic"))
    result = check(db_session, config(url="https://script.google.com/macros/s/synthetic/exec", sheet="synthetic", token="synthetic"))
    assert result["sheets"] == "configured"
