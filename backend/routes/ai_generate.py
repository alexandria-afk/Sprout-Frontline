import json
import asyncio
import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from dependencies import get_current_user, require_manager_or_above
from config import settings
from services.ai_logger import log_ai_request, AITimer
from services.industry_context import get_industry_context

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

    def _sync_create(sp: str, um: str):
        return client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=2048,
            system=sp,
            messages=[{"role": "user", "content": um}],
        )

    for attempt in range(max_retries):
        try:
            # Run the synchronous SDK call in a thread pool so it doesn't block the event loop
            response = await asyncio.to_thread(_sync_create, system_prompt, user_message)
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
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    text = await _call_claude(
        system_prompt=get_industry_context(org_id) + _REPAIR_GUIDE_SYSTEM,
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
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    text = await _call_claude(
        system_prompt=get_industry_context(org_id) + _ISSUE_CATEGORIES_SYSTEM,
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
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    text = await _call_claude(
        system_prompt=get_industry_context(org_id) + _SAFETY_BADGES_SYSTEM,
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
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    text = await _call_claude(
        system_prompt=get_industry_context(org_id) + _WORKFLOW_SYSTEM,
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


# ── 2a. Issue Classification ────────────────────────────────────────────────

class CategoryItem(BaseModel):
    id: str
    name: str


class ClassifyIssueRequest(BaseModel):
    title: str
    description: str
    available_categories: List[CategoryItem] = []


class ClassifyIssueResponse(BaseModel):
    type: str  # "issue" | "incident"
    category_id: Optional[str] = None
    priority: str
    suggested_title: str
    is_safety_risk: bool
    reasoning: str


_CLASSIFY_ISSUE_SYSTEM = """You are a safety and operations analyst for QSR and retail environments.
Classify the issue or incident and suggest a category, priority, and type.

Always respond with ONLY valid JSON — no markdown fences, no explanation.

Schema:
{
  "type": "issue" | "incident",
  "category_id": "string or null (pick from provided categories; null if none fit)",
  "priority": "low" | "medium" | "high" | "critical",
  "suggested_title": "string (concise action-oriented title, max 100 chars)",
  "is_safety_risk": true | false,
  "reasoning": "string (one sentence)"
}

Rules:
- type=incident if description mentions: injury, hurt, burn, fire, chemical, pest, rat, mouse, cockroach, vermin, blood, electric shock, fall, slip
- is_safety_risk=true if any of those keywords apply
- When is_safety_risk=true → priority is at minimum "high"; critical if immediate danger
- type=issue for physical faults, equipment problems, structural defects
- type=task (fallback) for process fixes, training, admin actions — but prefer issue/incident when in doubt
- Pick the best matching category_id from the provided list; null if none fit
"""


@router.post("/classify-issue", response_model=ClassifyIssueResponse)
async def classify_issue(
    body: ClassifyIssueRequest,
    current_user: dict = Depends(get_current_user),
):
    """Use AI to classify an issue or incident and suggest priority/category."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user.get("sub")

    cats_str = ""
    if body.available_categories:
        cats_str = "\nAvailable categories:\n" + "\n".join(
            f'- id: "{c.id}", name: "{c.name}"' for c in body.available_categories
        )

    user_message = f"Title: {body.title}\nDescription: {body.description}{cats_str}"

    with AITimer() as timer:
        try:
            text = await _call_claude(_CLASSIFY_ISSUE_SYSTEM, user_message)
            success = True
            error_msg = None
        except Exception as e:
            success = False
            error_msg = str(e)
            log_ai_request(
                feature="classify_issue", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=error_msg,
            )
            raise

    log_ai_request(
        feature="classify_issue", model="claude-haiku-4-5",
        input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
        success=success, org_id=org_id, user_id=user_id,
    )

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    try:
        return ClassifyIssueResponse(**data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI response did not match expected schema: {e}")


# ── 2b. Photo Hazard Analysis ───────────────────────────────────────────────

class AnalysePhotoRequest(BaseModel):
    image_url: str
    description: str


class AnalysePhotoResponse(BaseModel):
    safety_hazard_detected: bool
    hazard_description: Optional[str] = None
    suggested_category: str
    suggested_priority: str
    confidence: float
    ai_description: str


_ANALYSE_PHOTO_SYSTEM = """You are a workplace safety inspector for retail and QSR environments.
Analyse the provided photo and identify any hazards or maintenance issues.

Always respond with ONLY valid JSON — no markdown fences, no explanation.

Schema:
{
  "safety_hazard_detected": true | false,
  "hazard_description": "string describing the hazard, or null if none",
  "suggested_category": "string (e.g. Safety, Equipment, Cleanliness, Structural, Pest)",
  "suggested_priority": "low" | "medium" | "high" | "critical",
  "confidence": 0.0 to 1.0,
  "ai_description": "string (2-3 sentence description of what is visible in the photo)"
}

Rules:
- safety_hazard_detected=true if you see: spills, exposed wires, broken equipment, pests, fire hazards, blocked exits, unsafe storage
- critical: immediate danger; high: significant risk; medium: should be fixed soon; low: minor issue
- confidence reflects how certain you are about your analysis
"""


@router.post("/analyse-photo", response_model=AnalysePhotoResponse)
async def analyse_photo(
    body: AnalysePhotoRequest,
    current_user: dict = Depends(get_current_user),
):
    """Use AI vision to analyse a photo for safety hazards."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user.get("sub")

    client = _get_client()
    prompt = (
        f"Additional context from reporter: {body.description}\n\n"
        "Analyse this image for safety hazards, maintenance issues, or cleanliness problems. "
        "Respond with ONLY the JSON object described in your instructions."
    )

    # Build image source — data: URLs must be sent as base64 blocks, not URL references
    image_url = body.image_url
    if image_url.startswith("data:"):
        # data:image/jpeg;base64,/9j/4AA... → split on comma
        header, _, b64_data = image_url.partition(",")
        # header is like "data:image/jpeg;base64"
        media_type = header.split(":")[1].split(";")[0] if ":" in header else "image/jpeg"
        image_source = {"type": "base64", "media_type": media_type, "data": b64_data}
    else:
        image_source = {"type": "url", "url": image_url}

    with AITimer() as timer:
        try:
            response = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=1024,
                system=_ANALYSE_PHOTO_SYSTEM,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": image_source,
                        },
                        {"type": "text", "text": prompt},
                    ],
                }],
            )
            success = True
            error_msg = None
        except anthropic.AuthenticationError:
            raise HTTPException(status_code=503, detail="Invalid ANTHROPIC_API_KEY.")
        except anthropic.RateLimitError:
            raise HTTPException(status_code=429, detail="AI rate limit reached. Please try again in a moment.")
        except anthropic.APIError as e:
            log_ai_request(
                feature="analyse_photo", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=str(e),
            )
            raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    input_tokens = getattr(getattr(response, "usage", None), "input_tokens", None)
    output_tokens = getattr(getattr(response, "usage", None), "output_tokens", None)
    log_ai_request(
        feature="analyse_photo", model="claude-haiku-4-5",
        input_tokens=input_tokens, output_tokens=output_tokens, latency_ms=timer.elapsed_ms,
        success=True, org_id=org_id, user_id=user_id,
    )

    text = ""
    for block in response.content:
        if block.type == "text":
            text = block.text
            break

    if not text:
        raise HTTPException(status_code=502, detail="AI returned an empty response.")

    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        if "```" in text:
            text = text.rsplit("```", 1)[0]
        text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    try:
        return AnalysePhotoResponse(**data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI response did not match expected schema: {e}")


# ── 2c. Task Priority Suggestion ────────────────────────────────────────────

class SuggestTaskPriorityRequest(BaseModel):
    title: str
    description: Optional[str] = None
    context: Optional[str] = None


class SuggestTaskPriorityResponse(BaseModel):
    priority: str  # "low" | "medium" | "high" | "critical"
    reasoning: str


_SUGGEST_PRIORITY_SYSTEM = """You are an operations manager for a retail/QSR business.
Suggest the appropriate priority for a task based on its title and description.

Always respond with ONLY valid JSON — no markdown fences, no explanation.

Schema:
{
  "priority": "low" | "medium" | "high" | "critical",
  "reasoning": "string (one sentence explanation)"
}

Rules:
- critical: immediate safety risk, regulatory violation, or system down affecting operations
- high: significant impact on operations or customer experience; needs same-day attention
- medium: should be done within the week; noticeable but not urgent
- low: nice-to-have, minor improvement, or administrative task
"""


@router.post("/suggest-task-priority", response_model=SuggestTaskPriorityResponse)
async def suggest_task_priority(
    body: SuggestTaskPriorityRequest,
    current_user: dict = Depends(get_current_user),
):
    """Use AI to suggest priority for a task."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user.get("sub")

    parts = [f"Title: {body.title}"]
    if body.description:
        parts.append(f"Description: {body.description}")
    if body.context:
        parts.append(f"Context: {body.context}")
    user_message = "\n".join(parts)

    with AITimer() as timer:
        try:
            text = await _call_claude(_SUGGEST_PRIORITY_SYSTEM, user_message)
            success = True
        except Exception as e:
            log_ai_request(
                feature="suggest_task_priority", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=str(e),
            )
            raise

    log_ai_request(
        feature="suggest_task_priority", model="claude-haiku-4-5",
        input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
        success=True, org_id=org_id, user_id=user_id,
    )

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    try:
        return SuggestTaskPriorityResponse(**data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI response did not match expected schema: {e}")


# ── 2d. Audit Template Generation ───────────────────────────────────────────

class GenerateAuditTemplateRequest(BaseModel):
    topic: str
    passing_score: int = 70


@router.post("/generate-audit-template")
async def generate_audit_template_ai(
    body: GenerateAuditTemplateRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Use AI to generate a scored audit template draft."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user.get("sub")

    system_prompt = get_industry_context(org_id) + """You are an audit template designer for QSR and retail compliance.
Generate a fully scored audit template that frontline managers use during inspections.

Always respond with ONLY valid JSON — no markdown fences, no explanation.

Schema:
{
  "title": "string",
  "description": "string",
  "passing_score": number,
  "sections": [
    {
      "title": "string",
      "weight": number (sections must sum to 100),
      "fields": [
        {
          "label": "string",
          "field_type": "checkbox" | "text" | "number" | "photo" | "dropdown",
          "is_required": true | false,
          "is_critical": true | false,
          "scoring_type": "binary" | "partial",
          "max_score": number,
          "options": ["opt1", "opt2"] | null
        }
      ]
    }
  ]
}

Rules:
- Generate 3–5 sections with 4–7 fields each
- Section weights must sum to exactly 100
- Mark is_critical=true for regulatory or safety-critical items
- scoring_type=binary means 0 or max_score; partial means anywhere in between
- field_type=photo for visual verification; checkbox for yes/no compliance; dropdown for multi-option
- Keep field labels action-oriented and specific
- Include at least one photo field per section for verification
- Regulatory/safety items should have higher max_score (10–20); minor items 5–10
"""

    user_message = f"Generate an audit template for: {body.topic}\nPassing score threshold: {body.passing_score}%"

    with AITimer() as timer:
        try:
            text = await _call_claude(system_prompt, user_message)
            success = True
        except Exception as e:
            log_ai_request(
                feature="generate_audit_template", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=str(e),
            )
            raise

    log_ai_request(
        feature="generate_audit_template", model="claude-haiku-4-5",
        input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
        success=True, org_id=org_id, user_id=user_id,
    )

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    # Validate required top-level keys
    for key in ("title", "sections"):
        if key not in data:
            raise HTTPException(status_code=502, detail=f"AI response missing required field: {key}")

    data.setdefault("passing_score", body.passing_score)
    return data


# ── 2e. Quiz Generation ──────────────────────────────────────────────────────

class GenerateQuizRequest(BaseModel):
    course_id: str
    slides_content: List[str]
    num_questions: int = 5


@router.post("/generate-quiz")
async def generate_quiz(
    body: GenerateQuizRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Use AI to generate quiz questions from course slide content."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user.get("sub")

    system_prompt = get_industry_context(org_id) + f"""You are an instructional designer creating quiz questions for retail/QSR training courses.
Generate exactly {body.num_questions} multiple-choice questions based on the provided slide content.

Always respond with ONLY valid JSON — no markdown fences, no explanation.

Schema:
{{
  "questions": [
    {{
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correct_index": 0 | 1 | 2 | 3,
      "explanation": "string (why this answer is correct)"
    }}
  ]
}}

Rules:
- Each question must have exactly 4 options
- correct_index is 0-based (0 = first option)
- Questions should test understanding, not just recall
- Vary difficulty: some straightforward, some application-based
- Keep questions concise and unambiguous
- Explanations should reinforce the learning objective
"""

    slides_text = "\n\n---\n\n".join(body.slides_content)
    user_message = f"Course ID: {body.course_id}\n\nSlide content:\n{slides_text}"

    with AITimer() as timer:
        try:
            text = await _call_claude(system_prompt, user_message)
            success = True
        except Exception as e:
            log_ai_request(
                feature="generate_quiz", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=str(e),
            )
            raise

    log_ai_request(
        feature="generate_quiz", model="claude-haiku-4-5",
        input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
        success=True, org_id=org_id, user_id=user_id,
    )

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    if "questions" not in data:
        raise HTTPException(status_code=502, detail="AI response missing 'questions' field")

    return data


# ── 2f. Course Translation ───────────────────────────────────────────────────

SUPPORTED_LANGUAGES = [
    "English", "Filipino", "Spanish", "Mandarin",
    "Arabic", "Hindi", "Indonesian", "Thai",
]


class TranslateCourseRequest(BaseModel):
    course_id: str
    target_language: str
    content: dict  # {title, modules: [{title, slides: [{title, body}], quiz_questions: [{question, options, explanation}]}]}


@router.post("/translate-course")
async def translate_course(
    body: TranslateCourseRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Use AI to translate course content to the target language."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user.get("sub")

    if body.target_language not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language. Supported: {', '.join(SUPPORTED_LANGUAGES)}",
        )

    system_prompt = get_industry_context(org_id) + f"""You are a professional translator specialising in retail and QSR training content.
Translate the provided course content to {body.target_language}.

Always respond with ONLY valid JSON — no markdown fences, no explanation.
Return the same JSON structure as the input, with all text fields translated.
Preserve all JSON keys exactly as-is. Only translate the string values.
Maintain the same tone: professional, clear, and suitable for frontline retail staff.
"""

    user_message = f"Translate this course content to {body.target_language}:\n\n{json.dumps(body.content, ensure_ascii=False)}"

    with AITimer() as timer:
        try:
            text = await _call_claude(system_prompt, user_message)
            success = True
        except Exception as e:
            log_ai_request(
                feature="translate_course", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=str(e),
            )
            raise

    log_ai_request(
        feature="translate_course", model="claude-haiku-4-5",
        input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
        success=True, org_id=org_id, user_id=user_id,
    )

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    return data


# ── 2g. Knowledge Gaps ───────────────────────────────────────────────────────

class WrongAnswer(BaseModel):
    question: str
    chosen: str
    correct: str
    course_title: str


class KnowledgeGapsRequest(BaseModel):
    wrong_answers: List[WrongAnswer]


@router.post("/knowledge-gaps")
async def knowledge_gaps(
    body: KnowledgeGapsRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    """Use AI to identify knowledge gaps from wrong quiz answers."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user.get("sub")

    system_prompt = get_industry_context(org_id) + """You are a training specialist analysing quiz performance to identify knowledge gaps.
Based on wrong answers, identify patterns and recommend corrective actions.

Always respond with ONLY valid JSON — no markdown fences, no explanation.

Schema:
{
  "gaps": [
    {
      "topic": "string (the knowledge area or concept)",
      "description": "string (what the learner doesn't understand)",
      "severity": "low" | "medium" | "high",
      "recommended_action": "string (specific action to address this gap)"
    }
  ]
}

Rules:
- Group related wrong answers into a single gap (don't create one gap per wrong answer)
- severity=high if the topic is safety-critical or regulatory; medium if operationally important; low if minor
- recommended_action should be specific: "Re-take the Food Safety module", "Practice with a supervisor", etc.
- Identify 1–5 distinct gaps maximum
"""

    user_message = json.dumps([wa.model_dump() for wa in body.wrong_answers])

    with AITimer() as timer:
        try:
            text = await _call_claude(system_prompt, user_message)
            success = True
        except Exception as e:
            log_ai_request(
                feature="knowledge_gaps", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=str(e),
            )
            raise

    log_ai_request(
        feature="knowledge_gaps", model="claude-haiku-4-5",
        input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
        success=True, org_id=org_id, user_id=user_id,
    )

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    if "gaps" not in data:
        raise HTTPException(status_code=502, detail="AI response missing 'gaps' field")

    return data


# ── 2h. Learning Path ────────────────────────────────────────────────────────

class AvailableCourse(BaseModel):
    id: str
    title: str
    type: str


class LearningPathRequest(BaseModel):
    role: str
    completed_courses: List[str]
    quiz_scores: dict  # course_id -> score (float)
    available_courses: List[AvailableCourse]


@router.post("/learning-path")
async def learning_path(
    body: LearningPathRequest,
    current_user: dict = Depends(get_current_user),
):
    """Use AI to recommend a personalised learning path."""
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user.get("sub")

    system_prompt = get_industry_context(org_id) + """You are a learning and development specialist for retail/QSR.
Recommend a personalised learning path based on the learner's role, progress, and performance.

Always respond with ONLY valid JSON — no markdown fences, no explanation.

Schema:
{
  "recommended": [
    {
      "course_id": "string",
      "reason": "string (why this course is recommended for this learner)",
      "priority": 1 | 2 | 3 ... (1 = highest priority)
    }
  ]
}

Rules:
- Only recommend courses from the available_courses list
- Don't recommend already-completed courses unless the quiz score was below 70%
- Prioritise safety and compliance courses for all roles
- Consider role when recommending: managers need leadership content, staff need operational content
- Keep recommendations to 3–5 courses maximum
- Lower quiz scores should trigger re-recommendation of that course
"""

    user_message = json.dumps({
        "role": body.role,
        "completed_courses": body.completed_courses,
        "quiz_scores": body.quiz_scores,
        "available_courses": [c.model_dump() for c in body.available_courses],
    })

    with AITimer() as timer:
        try:
            text = await _call_claude(system_prompt, user_message)
            success = True
        except Exception as e:
            log_ai_request(
                feature="learning_path", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=str(e),
            )
            raise

    log_ai_request(
        feature="learning_path", model="claude-haiku-4-5",
        input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
        success=True, org_id=org_id, user_id=user_id,
    )

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    if "recommended" not in data:
        raise HTTPException(status_code=502, detail="AI response missing 'recommended' field")

    return data


# ── Sidekick Chat ─────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]


class ChatResponse(BaseModel):
    reply: str


SIDEKICK_SYSTEM = """You are Sidekick, a friendly AI assistant built into Sprout — a retail operations platform.
You help store managers and staff with:
- Questions about using the app (shifts, attendance, forms, tasks, training, announcements)
- General retail and QSR operations questions
- Scheduling, leave, and HR questions
- Store procedures and best practices

Keep replies concise and practical. Use bullet points for multi-step answers.
If you don't know something specific to their store, say so and suggest who to ask.
Never make up policy details — direct them to their manager or HR for specifics.
"""


@router.post("/chat", response_model=ChatResponse)
async def sidekick_chat(
    body: ChatRequest,
    current_user: dict = Depends(get_current_user),
):
    """Sidekick conversational AI — general-purpose assistant for the platform."""
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages cannot be empty")

    client = _get_client()
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    user_id = current_user.get("sub")
    sidekick_system = get_industry_context(org_id) + SIDEKICK_SYSTEM

    sdk_messages = [{"role": m.role, "content": m.content} for m in body.messages]

    def _sync_chat():
        return client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=1024,
            system=sidekick_system,
            messages=sdk_messages,
        )

    with AITimer() as timer:
        try:
            response = await asyncio.to_thread(_sync_chat)
        except anthropic.AuthenticationError:
            raise HTTPException(status_code=503, detail="Invalid ANTHROPIC_API_KEY.")
        except anthropic.RateLimitError:
            raise HTTPException(status_code=429, detail="AI rate limit reached. Please try again.")
        except anthropic.APIError as e:
            log_ai_request(
                feature="sidekick_chat", model="claude-haiku-4-5",
                input_tokens=None, output_tokens=None, latency_ms=timer.elapsed_ms,
                success=False, org_id=org_id, user_id=user_id, error_message=str(e),
            )
            raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    log_ai_request(
        feature="sidekick_chat", model="claude-haiku-4-5",
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        latency_ms=timer.elapsed_ms,
        success=True, org_id=org_id, user_id=user_id,
    )

    reply = "".join(block.text for block in response.content if hasattr(block, "text"))
    return ChatResponse(reply=reply)
