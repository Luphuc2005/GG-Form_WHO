from datetime import datetime
import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class AdminStatsResponse(BaseModel):
    total_submissions: int
    today_submissions: int
    by_classification: Dict[str, int]
    by_form_version: Dict[int, int]


class AdminSubmissionListItem(BaseModel):
    id: int
    submission_uuid: uuid.UUID
    reference_code: str
    form_version: int
    classification: str
    created_at: datetime
    so_hs: Optional[str] = None
    ho_ten: Optional[str] = None
    nam_sinh: Optional[str] = None
    tuoi: Optional[str] = None


class AdminSubmissionsPageResponse(BaseModel):
    items: List[AdminSubmissionListItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Optional[List[Any]] = None


class ErrorResponse(BaseModel):
    error: ErrorDetail
