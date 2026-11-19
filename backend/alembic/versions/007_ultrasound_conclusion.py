"""Publish the ultrasound conclusion field for an existing managed form."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json

from alembic import op
import sqlalchemy as sa

revision = "007_ultrasound_conclusion"
down_revision = "006_submission_trash"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    forms = sa.Table("form_versions", sa.MetaData(), autoload_with=bind)
    latest = bind.execute(sa.select(forms).where(
        forms.c.form_key == "ovarian-pathology-who", forms.c.status == "published",
    ).order_by(forms.c.version.desc()).limit(1)).mappings().first()
    if not latest:
        return
    schema = deepcopy(latest["schema_json"])
    fields = schema.get("clinical_fields")
    # Legacy forms take their clinical fields from the application contract.
    if fields is None or any(field["id"] == "sa_ket_luan" for field in fields):
        return
    insertion = next((i for i, field in enumerate(fields) if field["id"].startswith("iota_")),
                     max((i + 1 for i, field in enumerate(fields) if field["section"] == "sec4"), default=len(fields)))
    fields.insert(insertion, {
        "id": "sa_ket_luan", "label": "Kết luận siêu âm", "type": "textarea", "section": "sec4",
        "active": True, "required": False, "export": True, "choices": [], "help_text": "",
        "min_value": None, "max_value": None, "show_when": None, "show_values": [],
    })
    version = bind.scalar(sa.select(sa.func.max(forms.c.version)).where(forms.c.form_key == latest["form_key"])) + 1
    schema["version"] = version
    canonical = json.dumps(schema, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    now = datetime.now(timezone.utc)
    bind.execute(forms.insert().values(
        form_key=latest["form_key"], version=version, status="published", schema_json=schema,
        schema_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(), created_at=now, published_at=now,
    ))
    jobs = sa.Table("form_sheet_jobs", sa.MetaData(), autoload_with=bind)
    values = {"target_version": version, "status": "pending", "attempts": 0, "error": None, "attempted_at": None}
    existing = bind.scalar(sa.select(jobs.c.form_key).where(jobs.c.form_key == latest["form_key"]))
    if existing:
        bind.execute(jobs.update().where(jobs.c.form_key == latest["form_key"]).values(**values))
    else:
        bind.execute(jobs.insert().values(form_key=latest["form_key"], **values))


def downgrade():
    # Published versions can be referenced by patient records, so retain them.
    pass
