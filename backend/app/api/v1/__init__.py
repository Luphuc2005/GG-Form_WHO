from fastapi import APIRouter
from app.api.v1.forms import router as forms_router
from app.api.v1.submissions import router as submissions_router
from app.api.v1.admin import router as admin_router
from app.api.v1.records import router as records_router, accounts_router
from app.api.v1.public_records import router as public_router
from app.api.v1.form_builder import router as form_builder_router

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(forms_router)
api_v1_router.include_router(submissions_router)
api_v1_router.include_router(admin_router)
api_v1_router.include_router(form_builder_router)
api_v1_router.include_router(records_router)
api_v1_router.include_router(accounts_router)
api_v1_router.include_router(public_router)

__all__ = ["api_v1_router"]
