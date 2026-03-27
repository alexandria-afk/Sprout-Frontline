import json
import asyncio
import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
from dependencies import get_current_user, require_manager_or_above
from config import settings

router = APIRouter()


# ── Shared client ──────────────────────────────────────────────────────────────

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        api_key = settings.anthropic_api_key
        if not api_key:
            raise HTTPException(
                status_code=503,
                detail="ANTHROPIC_API_KEY is not configured. Add it to backend/.env to enable AI generation.",
            )
        _client = anthropic.Anthropic(api_key=api_key)
    return _client


async def _call_claude(system_prompt: str, user_message: str) -> str:
    """Call Claude with retry logic for overloaded errors. Returns raw text."""
    client = _get_client()
    max_retries = 3
    last_error: Exception | None = None

    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=2048,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            last_error = None
            break
        except anthropic.AuthenticationError:
            raise HTTPException(status_code=503, detail="Invalid ANTHROPIC_API_KEY.")
        except anthropic.RateLimitError:
            raise HTTPException(status_code=429, detail="AI rate limit reached. Please try again in a moment.")
        except anthropic.APIStatusError as e:
            if e.status_code == 529:
                last_error = e
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)
                continue
            raise HTTPException(status_code=502, detail=f"AI service error: {e.message}")
        except anthropic.APIError as e:
            raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    if last_error is not None:
        raise HTTPException(
            status_code=503,
            detail="The AI service is temporarily overloaded. Please wait a few seconds and try again.",
        )

    text = ""
    for block in response.content:
        if block.type == "text":
            text = block.text
            break

    if not text:
        raise HTTPException(status_code=502, detail="AI returned an empty response.")

    # Strip accidental markdown fences
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        if "```" in text:
            text = text.rsplit("```", 1)[0]
        text = text.strip()

    return text


# ── Request models ─────────────────────────────────────────────────────────────

class GeneratePromptRequest(BaseModel):
    prompt: str


# ── Response models ────────────────────────────────────────────────────────────

class RepairGuideResponse(BaseModel):
    title: str
    content: str


class IssueCategoryItem(BaseModel):
    name: str
    description: str
    color: str
    sla_hours: int


class IssueCategoriesResponse(BaseModel):
    categories: List[IssueCategoryItem]


class SafetyBadgeItem(BaseModel):
    name: str
    icon: str
    description: str
    criteria_type: str
    criteria_value: int
    criteria_window: str = "all_time"
    points_awarded: int


class SafetyBadgesResponse(BaseModel):
    badges: List[SafetyBadgeItem]


class GeneratedWorkflowStage(BaseModel):
    name: str
    action_type: str
    assigned_role: str | None = None
    sla_hours: int | None = None
    is_final: bool = False
    config: dict | None = None


class GeneratedWorkflowResponse(BaseModel):
    name: str
    trigger_type: str
    stages: List[GeneratedWorkflowStage]


# ── Endpoints ──────────────────────────────────────────────────────────────────

_REPAIR_GUIDE_SYSTEM = """You are a maintenance expert. Generate a concise repair guide in markdown format.

Always respond with ONLY a valid JSON object — no markdown fences, no explanation.

The JSON must match this exact schema:
{
  "title": "string (short, descriptive title for the repair guide)",
  "content": "string (the full repair guide written in markdown with clear steps, headings, and safety notes)"
}

Rules:
- Title should be concise, e.g. "How to Reset the HVAC Unit"
- Content should be well-structured markdown with ## headings, numbered steps, and bullet points
- Include a safety warning section if relevant
- Keep content practical and actionable for frontline maintenance staff
- Write for a Philippine retail/hospitality context where appropriate
"""


@router.post("/generate-repair-guide", response_model=RepairGuideResponse)
async def generate_repair_guide(
    body: GeneratePromptRequest,
    current_user: dict = Depends(get_current_user),
):
    """Use AI to generate a repair guide from a plain-text description."""
    text = await _call_claude(
        system_prompt=_REPAIR_GUIDE_SYSTEM,
        user_message=body.prompt.strip(),
    )
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    try:
        return RepairGuideResponse(**data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI response did not match expected schema: {e}")


_ISSUE_CATEGORIES_SYSTEM = """You are an operations manager. Suggest issue categories for a retail/hospitality business.

Always respond with ONLY a valid JSON object — no markdown fences, no explanation.

The JSON must match this exact schema:
{
  "categories": [
    {
      "name": "string",
      "description": "string",
      "color": "string (hex color, one of: #EF4444 #F97316 #EAB308 #22C55E #3B82F6 #8B5CF6 #EC4899)",
      "sla_hours": number (integer, e.g. 4 or 24 or 48)
    }
  ]
}

Rules:
- Generate 3 to 6 categories
- Each category should have a distinct, meaningful name
- Colors should vary across the list; pick the most appropriate color per category
- sla_hours should reflect urgency: critical issues 2-4h, moderate 24h, low-priority 48-72h
- Write for a Philippine retail/hospitality context where appropriate
"""


@router.post("/generate-issue-categories", response_model=IssueCategoriesResponse)
async def generate_issue_categories(
    body: GeneratePromptRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Use AI to generate issue category suggestions."""
    text = await _call_claude(
        system_prompt=_ISSUE_CATEGORIES_SYSTEM,
        user_message=body.prompt.strip(),
    )
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    try:
        return IssueCategoriesResponse(**data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI response did not match expected schema: {e}")


_SAFETY_BADGES_SYSTEM = """You are a safety manager. Suggest recognition badges for frontline workers.

Always respond with ONLY a valid JSON object — no markdown fences, no explanation.

The JSON must match this exact schema:
{
  "badges": [
    {
      "name": "string",
      "icon": "string (a single emoji)",
      "description": "string (short description of what the badge is awarded for)",
      "criteria_type": "string (one of: manual, issues_reported, issues_resolved, checklists_completed, checklist_streak_days, tasks_completed, audit_perfect_score)",
      "criteria_value": number (integer, e.g. 10 — ignored for manual type but still include a value like 1),
      "criteria_window": "string (one of: all_time, rolling_30_days, rolling_7_days)",
      "points_awarded": number (integer, e.g. 50)
    }
  ]
}

Rules:
- Generate 4 to 6 badges
- Use a variety of criteria_type values across the set
- Icons must be a single emoji character
- points_awarded should reflect badge prestige: easy badges 25-50 pts, medium 100-250 pts, hard 300-600 pts
- Make badge names motivating and memorable for frontline retail/hospitality staff
"""


@router.post("/generate-badges", response_model=SafetyBadgesResponse)
async def generate_badges(
    body: GeneratePromptRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Use AI to generate safety badge suggestions."""
    text = await _call_claude(
        system_prompt=_SAFETY_BADGES_SYSTEM,
        user_message=body.prompt.strip(),
    )
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    try:
        return SafetyBadgesResponse(**data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI response did not match expected schema: {e}")


_WORKFLOW_SYSTEM = """You are an operations workflow designer for a Philippine retail/hospitality platform called Frontline.
Generate a practical multi-stage approval workflow based on the user's description.

Always respond with ONLY a valid JSON object — no markdown fences, no explanation.

The JSON must match this exact schema:
{
  "name": "string (concise workflow name, e.g. 'Equipment Repair Approval')",
  "trigger_type": "string (one of: manual, audit_submitted, issue_created, incident_created, scheduled, form_submitted)",
  "stages": [
    {
      "name": "string (clear stage name, e.g. 'Manager Approval')",
      "action_type": "string (one of: fill_form, approve, sign, review, create_task, create_issue, create_incident, notify, wait)",
      "assigned_role": "string or null (one of: staff, manager, admin — null for system stages)",
      "sla_hours": number or null (integer hours for deadline, null if not applicable),
      "is_final": boolean (true only for the last stage),
      "config": object or null (only for system stages: notify needs {message, roles[]}, create_task needs {title, priority}, create_issue needs {title, priority}, wait needs {hours})
    }
  ]
}

Rules:
- Generate 2 to 5 stages — keep it practical
- Only the last stage should have is_final: true
- System stages (notify, create_task, create_issue, create_incident, wait) must have assigned_role: null
- Human stages (fill_form, approve, sign, review) should have assigned_role set to staff or manager
- notify config: { "message": "...", "roles": ["manager"] }
- create_task config: { "title": "...", "priority": "medium" } (priority: low/medium/high/critical)
- create_issue config: { "title": "...", "priority": "medium" }
- wait config: { "hours": 24 }
- Pick the trigger_type that best matches the description
- SLA hours: urgent stages 1-4h, standard 24h, non-urgent 48-72h
"""


@router.post("/generate-workflow", response_model=GeneratedWorkflowResponse)
async def generate_workflow(
    body: GeneratePromptRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Use AI to generate a workflow definition from a plain-text description."""
    text = await _call_claude(
        system_prompt=_WORKFLOW_SYSTEM,
        user_message=body.prompt.strip(),
    )
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    try:
        return GeneratedWorkflowResponse(**data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI response did not match expected schema: {e}")
