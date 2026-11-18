"""Upgrade a synthetic pre-workflow database and verify retained rows/passwords."""
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("stamped", [True, False])
def test_upgrade_preserves_legacy_records_and_is_repeatable(tmp_path, stamped):
    path = tmp_path / "legacy.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{path.as_posix()}", "APP_ENV":"test", "GOOGLE_SHEETS_WEBHOOK_URL":"", "GOOGLE_SHEETS_SPREADSHEET_ID":""}
    first = subprocess.run([sys.executable, "-B", "-m", "alembic", "upgrade", "001_initial_schema"], cwd=ROOT, env=env, capture_output=True, text=True)
    assert first.returncode == 0, first.stderr
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO admin_users (id,username,password_hash,is_active,created_at) VALUES (1,'synthetic_admin','preserve-this-hash',1,'2026-01-01')")
        db.execute("INSERT INTO form_versions (id,form_key,version,status,schema_json,schema_hash,created_at) VALUES (1,'synthetic',1,'published','{}','synthetic','2026-01-01')")
        db.execute("INSERT INTO submissions (id,submission_uuid,form_version_id,payload_hash,classification,answers,created_at) VALUES (1,'11111111-1111-4111-8111-111111111111',1,'synthetic','benign',?,'2026-01-01')", (json.dumps({"clinical_data":{"so_hs":"SYNTHETIC-ONLY"}}),))
        if not stamped:
            db.execute("DROP TABLE alembic_version")
    for _ in range(2):
        upgraded = subprocess.run([sys.executable, "-B", "upgrade_db.py"], cwd=ROOT, env=env, capture_output=True, text=True)
        assert upgraded.returncode == 0, upgraded.stderr
    boot = subprocess.run([sys.executable, "-B", "-m", "app.commands.create_admin", "--username", "synthetic_admin", "--password", "SyntheticChanged123!"], cwd=ROOT, env=env, capture_output=True, text=True)
    assert boot.returncode == 0, boot.stderr
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT password_hash,role FROM admin_users").fetchone() == ("preserve-this-hash", "admin")
        row = db.execute("SELECT answers,workflow_status,revision,owner_id FROM submissions").fetchone()
        assert json.loads(row[0])["clinical_data"]["so_hs"] == "SYNTHETIC-ONLY"
        assert row[1:] == ("submitted", 1, None)
        assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "005_form_management"
        assert db.execute("SELECT count(*) FROM form_drafts").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM form_sheet_jobs").fetchone()[0] == 0
        assert db.execute("SELECT identity_version,study_code FROM submissions").fetchone() == (1, None)
    assert len(list((tmp_path / "backups").glob("*.db"))) == 1
