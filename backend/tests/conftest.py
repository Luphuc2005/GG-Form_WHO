import os
import json
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Set test environment
os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-secret-key-at-least-32-characters-long!"

from app.database import Base, get_db
from app.main import app
from app.models.form_version import FormVersion
from app.models.admin_user import AdminUser
from app.core.security import hash_password

# In-memory test engine
engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="session", autouse=True)
def setup_database():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def db_session():
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)

    # Seed default published form v1
    form_file_path = os.path.join(os.path.dirname(__file__), "..", "..", "form-definitions", "ovarian-pathology-v1.json")
    if not os.path.exists(form_file_path):
        form_file_path = os.path.join(os.path.dirname(__file__), "ovarian-pathology-v1.json")

    with open(form_file_path, "r", encoding="utf-8") as f:
        form_json = json.load(f)

    existing_form = session.query(FormVersion).filter_by(form_key="ovarian-pathology-who", version=1).first()
    if not existing_form:
        form_v1 = FormVersion(
            form_key="ovarian-pathology-who",
            version=1,
            status="published",
            schema_json=form_json,
            schema_hash="test-hash-v1",
            created_at=datetime.now(timezone.utc),
            published_at=datetime.now(timezone.utc),
        )
        session.add(form_v1)

    # Seed admin user
    existing_admin = session.query(AdminUser).filter_by(username="admin").first()
    if not existing_admin:
        admin = AdminUser(
            username="admin",
            password_hash=hash_password("AdminTest123!"),
            is_active=True,
            created_at=datetime.now(timezone.utc)
        )
        session.add(admin)

    session.commit()

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture(scope="function")
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
