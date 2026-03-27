import json
import asyncio
import anthropic
from fastapi import HTTPException
from models.forms import GenerateTemplateRequest, CreateFormTemplateRequest
from config import settings


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


_SYSTEM_PROMPT = """You are a form template designer for a retail operations platform called Frontline.
You generate practical, professional form templates that frontline staff use daily.

Always respond with ONLY a valid JSON object — no markdown fences, no explanation.

The JSON must match this exact schema:
{
  "title": "string",
  "description": "string",
  "type": "form" | "checklist",
  "sections": [
    {
      "title": "string",
      "display_order": 0,
      "fields": [
        {
          "label": "string",
          "field_type": "text" | "number" | "checkbox" | "dropdown" | "multi_select" | "photo" | "signature" | "datetime",
          "is_required": true | false,
          "placeholder": "string (a short example or hint shown in grey, e.g. 'e.g. SM Megamall – Ground Floor')",
          "options": ["opt1", "opt2"] | null,
          "display_order": 0
        }
      ]
    }
  ]
}

Rules:
- Use 2–4 sections with 3–6 fields each
- Write placeholders as short, realistic examples (start with "e.g." for text/number fields)
- For checkbox fields, placeholder should be a short instruction like "Check if completed"
- For photo fields, placeholder should say what to photograph, e.g. "Take a photo of the display area"
- For dropdown/multi_select, always include an "options" array of 3–5 realistic choices
- For signature fields, placeholder should be "Tap to sign"
- Make everything specific to Philippine retail context where appropriate
"""


async def generate_template(body: GenerateTemplateRequest) -> CreateFormTemplateRequest:
    client = _get_client()

    user_message = (
        f'Generate a {body.type} template for: "{body.description}"\n'
        f'Type must be: "{body.type}"'
    )

    # Retry up to 3 times on overloaded errors with exponential backoff
    max_retries = 3
    last_error: Exception | None = None

    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-haiku-4-5",
                max_tokens=4096,
                system=_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_message}],
            )
            last_error = None
            break
        except anthropic.AuthenticationError:
            raise HTTPException(status_code=503, detail="Invalid ANTHROPIC_API_KEY.")
        except anthropic.RateLimitError as e:
            raise HTTPException(status_code=429, detail="AI rate limit reached. Please try again in a moment.")
        except anthropic.APIStatusError as e:
            if e.status_code == 529:
                last_error = e
                if attempt < max_retries - 1:
                    await asyncio.sleep(2 ** attempt)  # 1s, 2s, 4s
                continue
            raise HTTPException(status_code=502, detail=f"AI service error: {e.message}")
        except anthropic.APIError as e:
            raise HTTPException(status_code=502, detail=f"AI service error: {e}")

    if last_error is not None:
        raise HTTPException(
            status_code=503,
            detail="The AI service is temporarily overloaded. Please wait a few seconds and try again.",
        )

    # Extract text block from response
    text = ""
    for block in response.content:
        if block.type == "text":
            text = block.text
            break

    if not text:
        raise HTTPException(status_code=502, detail="AI returned an empty response.")

    # Strip any accidental markdown fences
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
        return CreateFormTemplateRequest(**data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI response did not match expected schema: {e}")
