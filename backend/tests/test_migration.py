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
        assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "009_capacity_jobs"
        assert db.execute("SELECT count(*) FROM export_jobs").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM sheet_cleanup_jobs").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM form_drafts").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM form_sheet_jobs").fetchone()[0] == 0
        assert db.execute("SELECT identity_version,study_code FROM submissions").fetchone() == (1, None)
        assert db.execute("SELECT trashed_at,trashed_from_state FROM submissions").fetchone() == (None, None)
    assert len(list((tmp_path / "backups").glob("*.db"))) == 1


def test_ultrasound_migration_publishes_managed_version_without_rewriting_history(tmp_path):
    path = tmp_path / "managed.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{path.as_posix()}", "APP_ENV": "test",
           "GOOGLE_SHEETS_WEBHOOK_URL": "", "GOOGLE_SHEETS_SPREADSHEET_ID": ""}
    first = subprocess.run([sys.executable, "-B", "-m", "alembic", "upgrade", "006_submission_trash"],
                           cwd=ROOT, env=env, capture_output=True, text=True)
    assert first.returncode == 0, first.stderr
    schema = {"form_key": "ovarian-pathology-who", "version": 1, "title": "Synthetic",
              "fields": [], "clinical_fields": [
                  {"id": "custom_name", "label": "Tên riêng giữ nguyên", "type": "text", "section": "sec4"},
                  {"id": "sa_ton_thuong_nmtc", "label": "Tổn thương NMTC", "type": "select", "section": "sec4"},
                  {"id": "iota_benign", "label": "IOTA", "type": "number", "section": "sec4"},
              ]}
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO form_versions (id,form_key,version,status,schema_json,schema_hash,created_at) "
                   "VALUES (1,'ovarian-pathology-who',1,'published',?,'synthetic','2026-01-01')", (json.dumps(schema),))
        db.execute("INSERT INTO submissions (submission_uuid,form_version_id,payload_hash,classification,answers,created_at) "
                   "VALUES ('11111111-1111-4111-8111-111111111111',1,'synthetic','benign','{}','2026-01-01')")
    for _ in range(2):
        result = subprocess.run([sys.executable, "-B", "upgrade_db.py"], cwd=ROOT, env=env, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
    with sqlite3.connect(path) as db:
        versions = db.execute("SELECT version,schema_json FROM form_versions ORDER BY version").fetchall()
        assert len(versions) == 2 and json.loads(versions[0][1]) == schema
        new = json.loads(versions[1][1])
        assert new["version"] == 2
        assert [field["id"] for field in new["clinical_fields"]] == [
            "custom_name", "sa_ton_thuong_nmtc", "sa_ket_luan", "iota_benign",
        ]
        assert new["clinical_fields"][0] == schema["clinical_fields"][0]
        field = new["clinical_fields"][2]
        assert field["type"] == "textarea" and not field["required"] and field["export"]
        assert db.execute("SELECT form_version_id FROM submissions").fetchone()[0] == 1
        assert db.execute("SELECT target_version,status FROM form_sheet_jobs").fetchone() == (2, "pending")
