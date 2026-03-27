from __future__ import annotations
from datetime import datetime
from typing import Optional, List, Any
from uuid import UUID
from pydantic import BaseModel


# -- Slides --
class SlidePayload(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    image_url: Optional[str] = None
    display_order: int = 0


# -- Quiz Options --
class QuizOption(BaseModel):
    id: str
    text: str
    is_correct: bool


# -- Quiz Questions --
class QuizQuestionPayload(BaseModel):
    question: str
    question_type: str = "multiple_choice"
    image_url: Optional[str] = None
    options: List[QuizOption] = []
    explanation: Optional[str] = None
    display_order: int = 0


# -- Modules --
class ModulePayload(BaseModel):
    title: str
    module_type: str  # slides | video | pdf | quiz
    content_url: Optional[str] = None
    display_order: int = 0
    is_required: bool = True
    estimated_duration_mins: Optional[int] = None
    slides: List[SlidePayload] = []
    questions: List[QuizQuestionPayload] = []


# -- Course Create/Update --
class CreateCourseRequest(BaseModel):
    title: str
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    estimated_duration_mins: Optional[int] = None
    passing_score: int = 80
    max_retakes: Optional[int] = 3
    cert_validity_days: Optional[int] = None
    is_mandatory: bool = False
    target_roles: List[str] = []
    target_location_ids: List[str] = []
    language: str = "en"
    modules: List[ModulePayload] = []


class UpdateCourseRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None
    estimated_duration_mins: Optional[int] = None
    passing_score: Optional[int] = None
    max_retakes: Optional[int] = None
    cert_validity_days: Optional[int] = None
    is_mandatory: Optional[bool] = None
    target_roles: Optional[List[str]] = None
    target_location_ids: Optional[List[str]] = None
    language: Optional[str] = None


# -- AI Generation --
class GenerateCourseRequest(BaseModel):
    input_type: str  # topic | url | document | video
    input_data: Optional[str] = None   # topic text or URL
    input_file_url: Optional[str] = None  # for document/video
    target_role: Optional[str] = None
    language: str = "en"


# -- Enrollment --
class EnrollRequest(BaseModel):
    course_id: str
    user_ids: List[str]
    is_mandatory: bool = False


# -- Progress --
class UpdateProgressRequest(BaseModel):
    module_id: str
    status: str  # not_started | in_progress | completed
    time_spent_seconds: Optional[int] = None


# -- Quiz Submit --
class QuizAnswer(BaseModel):
    question_id: str
    selected_option: str


class SubmitQuizRequest(BaseModel):
    module_id: str
    answers: List[QuizAnswer]
