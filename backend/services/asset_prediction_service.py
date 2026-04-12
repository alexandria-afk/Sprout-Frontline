"""
Asset failure prediction — uses Claude to estimate days-to-failure and risk score
based on the asset's maintenance history, age, and repair costs.

Called:
  - Automatically after a maintenance ticket is resolved (background task)
  - On demand via POST /api/v1/assets/{asset_id}/predict
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

import anthropic

from config import settings
from services.ai_logger import AITimer, log_ai_request
from services.db import row, rows, execute

logger = logging.getLogger(__name__)

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured.")
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    return _client


async def predict_asset_failure(conn, asset_id: str, org_id: str) -> dict:
    """
    Fetch asset data and maintenance history, call Claude to predict failure,
    persist results to assets table, and return the prediction dict.

    Returns: {"predicted_days_to_failure": int | None, "failure_risk_score": float | None}
    """
    # ── Fetch asset ─────────────────────────────────────────────────────────────
    asset = row(
        conn,
        """
        SELECT id, name, category, model, manufacturer,
               installed_at, last_maintenance_at, next_maintenance_due_at,
               total_repair_cost, status, organisation_id
        FROM assets
        WHERE id = %s AND organisation_id = %s AND is_deleted = FALSE
        """,
        (asset_id, org_id),
    )
    if not asset:
        raise ValueError(f"Asset {asset_id} not found")

    # ── Fetch maintenance ticket history ─────────────────────────────────────────
    tickets = rows(
        conn,
        """
        SELECT title, priority, status, cost, created_at, resolved_at, resolution_note
        FROM maintenance_tickets
        WHERE asset_id = %s AND is_deleted = FALSE
        ORDER BY created_at DESC
        LIMIT 20
        """,
        (asset_id,),
    )

    # ── Build context for Claude ──────────────────────────────────────────────────
    now = datetime.now(timezone.utc)

    def _age_days(ts) -> int | None:
        if not ts:
            return None
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                return None
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return (now - ts).days

    asset_age_days = _age_days(asset.get("installed_at"))
    days_since_maintenance = _age_days(asset.get("last_maintenance_at"))

    ticket_summaries = []
    for t in tickets:
        resolved = "yes" if t.get("status") == "resolved" else "no"
        cost_str = f"${float(t.get('cost') or 0):.2f}" if t.get("cost") else "unknown"
        age = _age_days(t.get("created_at"))
        ticket_summaries.append(
            f"- [{t.get('priority', 'medium')} priority] {t.get('title', 'Maintenance')} "
            f"| resolved: {resolved} | cost: {cost_str} | {age} days ago"
        )

    ticket_block = "\n".join(ticket_summaries) if ticket_summaries else "No maintenance history"
    total_cost = float(asset.get("total_repair_cost") or 0)

    system_prompt = (
        "You are a predictive maintenance AI for retail equipment. "
        "Given asset data and maintenance history, estimate the likelihood of failure. "
        "Respond ONLY with a JSON object — no markdown, no explanation. "
        'Example: {"predicted_days_to_failure": 45, "failure_risk_score": 0.72}'
    )

    user_message = f"""Asset: {asset.get("name", "Unknown")}
Category: {asset.get("category") or "N/A"}
Model: {asset.get("model") or "N/A"} | Manufacturer: {asset.get("manufacturer") or "N/A"}
Age: {asset_age_days if asset_age_days is not None else "unknown"} days since installation
Days since last maintenance: {days_since_maintenance if days_since_maintenance is not None else "never"}
Total lifetime repair cost: ${total_cost:.2f}
Current status: {asset.get("status", "active")}

Maintenance ticket history (most recent first):
{ticket_block}

Based on this data, predict:
1. predicted_days_to_failure: integer number of days until likely failure (0-3650). Use 3650 if asset appears very healthy.
2. failure_risk_score: float between 0.0 (no risk) and 1.0 (imminent failure)

Reply with JSON only."""

    # ── Call Claude ───────────────────────────────────────────────────────────────
    client = _get_client()
    feature = "asset_failure_prediction"
    input_tokens = 0
    output_tokens = 0
    error_message = None
    predicted_days = None
    risk_score = None

    def _sync():
        return client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=256,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )

    with AITimer() as timer:
        try:
            for attempt in range(3):
                try:
                    response = await asyncio.to_thread(_sync)
                    break
                except anthropic.RateLimitError:
                    if attempt < 2:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    raise
                except anthropic.APIStatusError as e:
                    if e.status_code == 529 and attempt < 2:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    raise

            input_tokens = response.usage.input_tokens
            output_tokens = response.usage.output_tokens

            text = "".join(b.text for b in response.content if hasattr(b, "text")).strip()
            # Strip markdown fences if present
            if text.startswith("```"):
                text = text.split("```", 2)[1]
                if text.startswith("json"):
                    text = text[4:]
                if "```" in text:
                    text = text.rsplit("```", 1)[0]
                text = text.strip()

            parsed = json.loads(text)
            predicted_days = int(parsed.get("predicted_days_to_failure", 0)) or None
            risk_score = float(parsed.get("failure_risk_score", 0.0))
            # Clamp risk score to [0, 1]
            risk_score = max(0.0, min(1.0, risk_score))

        except Exception as exc:
            error_message = str(exc)
            logger.error("Asset failure prediction failed for %s: %s", asset_id, exc)

    # ── Log AI request ────────────────────────────────────────────────────────────
    try:
        log_ai_request(
            feature=feature,
            model="claude-haiku-4-5",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=timer.elapsed_ms,
            success=error_message is None,
            org_id=org_id,
            user_id=None,
            error_message=error_message,
        )
    except Exception as log_exc:
        logger.warning("Failed to log AI request: %s", log_exc)

    # ── Persist to assets table ───────────────────────────────────────────────────
    if predicted_days is not None or risk_score is not None:
        try:
            execute(
                conn,
                """
                UPDATE assets
                SET predicted_days_to_failure = %s,
                    failure_risk_score = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (predicted_days, risk_score, now.isoformat(), asset_id),
            )
        except Exception as db_exc:
            logger.error("Failed to persist prediction for asset %s: %s", asset_id, db_exc)

    return {
        "predicted_days_to_failure": predicted_days,
        "failure_risk_score": risk_score,
    }
