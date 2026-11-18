from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class StudySequence(Base):
    __tablename__ = "study_sequences"
    hospital_code: Mapped[str] = mapped_column(String(2), primary_key=True)
    phase: Mapped[str] = mapped_column(String(1), primary_key=True)
    last_value: Mapped[int] = mapped_column(Integer, nullable=False)
