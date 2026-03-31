"""
Shared AI/LLM utility helpers.
"""


def _strip_code_fence(text: str) -> str:
    """Remove markdown code fences from an AI response (```json ... ``` or ``` ... ```)."""
    text = text.strip()
    if text.startswith("```"):
        text = text[3:]                          # drop opening ```
        if text.startswith("json"):
            text = text[4:]                      # drop language tag
        text = text.strip()
        if text.endswith("```"):
            text = text[:-3].strip()             # drop closing ```
        elif "```" in text:
            text = text[:text.index("```")].strip()
    return text
