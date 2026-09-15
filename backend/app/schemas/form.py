from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class FormOptionSchema(BaseModel):
    id: str
    label: str
    numericCode: Optional[int] = None
    has_other_text: Optional[bool] = False
    other_placeholder: Optional[str] = None
    children: List["FormOptionSchema"] = Field(default_factory=list)


FormOptionSchema.model_rebuild()


class FormFieldSchema(BaseModel):
    id: str
    type: str  # "checkbox-group", "radio", "text", etc.
    label: str
    required: bool = False
    error_message: Optional[str] = None
    options: List[FormOptionSchema] = Field(default_factory=list)


class FormSchemaDefinition(BaseModel):
    form_key: str
    version: int
    title: str
    description: Optional[str] = None
    fields: List[FormFieldSchema]


class FormVersionResponse(BaseModel):
    id: int
    form_key: str
    version: int
    status: str
    schema_json: FormSchemaDefinition
    schema_hash: str
    published_at: Optional[datetime] = None
