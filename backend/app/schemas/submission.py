import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
from pydantic import BaseModel, Field, ConfigDict


class SelectedOptionPayload(BaseModel):
    id: str
    slot: Optional[Literal[1, 2]] = None
    children: List["SelectedOptionPayload"] = Field(default_factory=list)
    other_text: Optional[str] = None


SelectedOptionPayload.model_rebuild()


class PathologyAnswerPayload(BaseModel):
    selected: List[SelectedOptionPayload] = Field(default_factory=list)
    other_text: Optional[str] = None


class AnswersPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    pathology: Optional[PathologyAnswerPayload] = Field(default_factory=PathologyAnswerPayload)
    classification: Optional[str] = "unspecified"
    clinical_data: Optional[Dict[str, Any]] = Field(default_factory=dict)


class SubmissionCreateRequest(BaseModel):
    submission_uuid: uuid.UUID
    form_version: int
    answers: AnswersPayload


class SubmissionResponse(BaseModel):
    submission_uuid: uuid.UUID
    reference_code: str
    form_version: int
    status: str = "success"
    created_at: datetime
    message: str = "Gửi phiếu thành công"


class SubmissionDetailResponse(BaseModel):
    id: int
    submission_uuid: uuid.UUID
    form_version: int
    classification: str
    answers: Dict[str, Any]
    created_at: datetime


class SubmissionStatusResponse(BaseModel):
    submission_uuid: uuid.UUID
    status: str
    created_at: datetime
