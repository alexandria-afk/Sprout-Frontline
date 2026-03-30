import json
import asyncio
import base64
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


async def _call_with_retries(client: anthropic.Anthropic, messages: list, max_tokens: int = 4096) -> str:
    """Call Claude with retry logic. Returns raw text content."""
    max_retries = 3
    last_error: Exception | None = None
    response = None

    def _sync_create(msgs: list, mt: int):
        return client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=mt,
            system=_SYSTEM_PROMPT,
            messages=msgs,
        )

    for attempt in range(max_retries):
        try:
            # Run synchronous SDK call in a thread pool to avoid blocking the event loop
            response = await asyncio.to_thread(_sync_create, messages, max_tokens)
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

    # Strip any accidental markdown fences
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
        if "```" in text:
            text = text.rsplit("```", 1)[0]
        text = text.strip()

    return text


async def _fetch_url_content(url: str) -> str:
    """Fetch text content from a URL using httpx."""
    try:
        import httpx
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="httpx is required for URL-based form generation. Install it with: pip install httpx",
        )

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as http:
            resp = await http.get(url, headers={"User-Agent": "Frontline-FormGen/1.0"})
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "html" in content_type:
                # Strip HTML tags naively for basic text extraction
                import re
                text = re.sub(r"<[^>]+>", " ", resp.text)
                text = re.sub(r"\s+", " ", text).strip()
                return text[:8000]  # cap to avoid token overflow
            return resp.text[:8000]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch URL content: {e}")


async def generate_template(body: GenerateTemplateRequest) -> CreateFormTemplateRequest:
    client = _get_client()

    input_type = body.input_type or "topic"

    if input_type == "url" and body.url:
        # Fetch URL content and pass as text
        url_text = await _fetch_url_content(body.url)
        user_message = (
            f'Generate a {body.type} template based on the following content from {body.url}.\n'
            f'Description hint: "{body.description}"\n'
            f'Type must be: "{body.type}"\n\n'
            f'Source content:\n{url_text}'
        )
        messages = [{"role": "user", "content": user_message}]

    elif input_type == "document" and body.document_base64:
        # Pass document as base64 to Claude's document API
        user_message = (
            f'Generate a {body.type} template based on the attached document.\n'
            f'Description hint: "{body.description}"\n'
            f'Type must be: "{body.type}"'
        )
        messages = [{
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": body.document_base64,
                    },
                },
                {"type": "text", "text": user_message},
            ],
        }]

    else:
        # Default: topic-based generation (backward compat)
        user_message = (
            f'Generate a {body.type} template for: "{body.description}"\n'
            f'Type must be: "{body.type}"'
        )
        messages = [{"role": "user", "content": user_message}]

    text = await _call_with_retries(client, messages)

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=502, detail=f"AI returned invalid JSON: {e}")

    try:
        return CreateFormTemplateRequest(**data)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI response did not match expected schema: {e}")
