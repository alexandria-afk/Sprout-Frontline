from typing import Generic, TypeVar
from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total_count: int
    page: int
    page_size: int


class SuccessEnvelope(BaseModel, Generic[T]):
    success: bool = True
    message: str = "ok"
    data: T | None = None


class ErrorEnvelope(BaseModel):
    success: bool = False
    message: str
    errors: list[str] = []
