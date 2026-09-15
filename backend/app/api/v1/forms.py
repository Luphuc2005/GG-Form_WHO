from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.exceptions import NotFoundException
from app.database import get_db
from app.repositories.form_repo import FormRepository
from app.schemas.form import FormVersionResponse

router = APIRouter(prefix="/forms", tags=["Forms"])


@router.get("/current", response_model=FormVersionResponse)
def get_current_published_form(db: Session = Depends(get_db)):
    """Fetch the latest published form schema."""
    form_ver = FormRepository.get_published_by_key(db, "ovarian-pathology-who")
    if not form_ver:
        raise NotFoundException("Hiện chưa có biểu mẫu nào được công bố.")
    return form_ver


@router.get("/{version}", response_model=FormVersionResponse)
def get_form_by_version(version: int, db: Session = Depends(get_db)):
    """Fetch a specific version of the form schema."""
    form_ver = FormRepository.get_by_key_and_version(db, "ovarian-pathology-who", version)
    if not form_ver:
        raise NotFoundException(f"Không tìm thấy biểu mẫu phiên bản {version}.")
    return form_ver
