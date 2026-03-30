"""
AI Request Logger
Logs every Claude call to ai_request_log for cost tracking and debugging.
Non-fatal — failures here never block the AI feature.
"""
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)


def log_ai_request(
    *,
    feature: str,
    model: str,
    input_tokens: Optional[int],
    output_tokens: Optional[int],
    latency_ms: int,
    success: bool,
    org_id: Optional[str] = None,
    user_id: Optional[str] = None,
    error_message: Optional[str] = None,
) -> None:
    """Write one row to ai_request_log. Swallows all exceptions."""
    try:
        from services.supabase_client import get_admin_client
        supabase = get_admin_client()
        supabase.table("ai_request_log").insert({
            "feature": feature,
            "provider": "anthropic",
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "latency_ms": latency_ms,
            "success": success,
            "organisation_id": org_id,
            "user_id": user_id,
            "error_message": error_message,
        }).execute()
    except Exception as e:
        logger.debug(f"ai_logger: failed to log request: {e}")


class AITimer:
    """Context manager that measures elapsed ms for an AI call."""
    def __init__(self):
        self._start: float = 0.0
        self.elapsed_ms: int = 0

    def __enter__(self):
        self._start = time.monotonic()
        return self

    def __exit__(self, *_):
        self.elapsed_ms = int((time.monotonic() - self._start) * 1000)
