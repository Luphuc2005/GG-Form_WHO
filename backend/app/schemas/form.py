from datetime import datetime
from typing import Any, Dict, List, Optional, Union, Literal
from pydantic import BaseModel, Field


class FormOptionSchema(BaseModel):
    id: str
    label: str
    numericCode: Optional[Union[str, int]] = None
    classification: Optional[str] = None
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


class ClinicalFieldSchema(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    label: str = Field(min_length=1, max_length=160)
    type: Literal["text", "textarea", "number", "date", "select", "multiselect"] = "text"
    section: Literal["sec1", "sec2", "sec3", "sec4", "sec5", "sec6", "extra"] = "extra"
    required: bool = False
    active: bool = True
    export: bool = True
    choices: List[str] = Field(default_factory=list, max_length=100)
    help_text: str = Field(default="", max_length=500)
    min_value: float | None = Field(default=None, allow_inf_nan=False)
    max_value: float | None = Field(default=None, allow_inf_nan=False)
    show_when: Optional[str] = None
    show_values: List[str] = Field(default_factory=list)


class FormSchemaDefinition(BaseModel):
    form_key: str
    version: int
    title: str
    description: Optional[str] = None
    fields: List[FormFieldSchema]
    clinical_fields: Optional[List[ClinicalFieldSchema]] = Field(default=None, max_length=250)


class FormVersionResponse(BaseModel):
    id: int
    form_key: str
    version: int
    status: str
    schema_json: FormSchemaDefinition
    schema_hash: str
    published_at: Optional[datetime] = None
