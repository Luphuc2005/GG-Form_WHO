import pytest
from app.core.exceptions import ValidationErrorException
from app.schemas.form import FormFieldSchema, FormOptionSchema, FormSchemaDefinition
from app.schemas.submission import AnswersPayload, PathologyAnswerPayload, SelectedOptionPayload
from app.services.validator import validate_submission_against_schema


@pytest.fixture
def sample_schema():
    return FormSchemaDefinition(
        form_key="test-form",
        version=1,
        title="Test Form",
        fields=[
            FormFieldSchema(
                id="pathology",
                type="checkbox-group",
                label="Giải phẫu bệnh",
                required=True,
                options=[
                    FormOptionSchema(
                        id="parent_a",
                        label="Parent A",
                        children=[
                            FormOptionSchema(id="child_a1", label="Child A1", children=[]),
                            FormOptionSchema(
                                id="child_a2",
                                label="Child A2",
                                children=[
                                    FormOptionSchema(
                                        id="grandchild_a2_1",
                                        label="Grandchild A2-1",
                                        children=[]
                                    )
                                ]
                            ),
                        ]
                    ),
                    FormOptionSchema(
                        id="parent_b",
                        label="Parent B",
                        children=[
                            FormOptionSchema(
                                id="opt_other",
                                label="Khác",
                                has_other_text=True,
                                children=[]
                            )
                        ]
                    )
                ]
            ),
            FormFieldSchema(
                id="classification",
                type="radio",
                label="Lành/Ác",
                required=True,
                options=[
                    FormOptionSchema(id="benign", label="Lành", children=[]),
                    FormOptionSchema(id="malignant", label="Ác", children=[]),
                ]
            )
        ]
    )


def test_validator_deep_nesting_success(sample_schema):
    answers = AnswersPayload(
        pathology=PathologyAnswerPayload(
            selected=[
                SelectedOptionPayload(
                    id="parent_a",
                    children=[
                        SelectedOptionPayload(
                            id="child_a2",
                            children=[
                                SelectedOptionPayload(id="grandchild_a2_1")
                            ]
                        )
                    ]
                )
            ]
        ),
        classification="benign"
    )
    # Should validate without error
    validate_submission_against_schema(sample_schema, answers)


def test_validator_invalid_child_hierarchy(sample_schema):
    answers = AnswersPayload(
        pathology=PathologyAnswerPayload(
            selected=[
                SelectedOptionPayload(
                    id="parent_a",
                    children=[
                        # grandchild_a2_1 attached directly under parent_a instead of child_a2
                        SelectedOptionPayload(id="grandchild_a2_1")
                    ]
                )
            ]
        ),
        classification="benign"
    )
    with pytest.raises(ValidationErrorException):
        validate_submission_against_schema(sample_schema, answers)
