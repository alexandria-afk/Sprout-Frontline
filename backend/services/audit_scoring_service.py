"""
Audit Scoring Engine — Phase 2
Scoring is always calculated server-side. Never accept a pre-calculated score from the client.

Formula:
  score_per_field = (response_ratio) * audit_field_scores.max_score * section_weight
  section_score   = sum(earned) / sum(possible) per section (as %)
  overall_score   = weighted average of section scores (%)
  passed          = overall_score >= audit_configs.passing_score AND no critical item failed

Three-tier audit_item responses:
  compliant         → ratio 1.0  (full score, not failed)
  needs_improvement → ratio 0.5  (partial score, not failed)
  non_compliant     → ratio 0.0  (no score, is_failed=True)

Critical items (is_critical=True on form_fields):
  If any critical field is_failed, the entire audit auto-fails regardless of overall_score.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from services.db import row, rows

logger = logging.getLogger(__name__)

# Field types treated as evidence only (no score contribution)
EVIDENCE_FIELD_TYPES = {"photo", "video", "signature", "file", "gps", "qr_code",
                        "text", "textarea", "date", "time", "datetime"}

# Response values that count as "failed" for CAP generation (legacy binary types)
FAIL_VALUES = {"false", "0", "fail", "no", "n/a"}

# Three-tier audit_item ratios
AUDIT_ITEM_RATIOS: dict[str, float] = {
    "compliant": 1.0,
    "needs_improvement": 0.5,
    "non_compliant": 0.0,
}


@dataclass
class FieldScoreResult:
    field_id: str
    label: str
    field_type: str
    max_score: float
    achieved_score: float
    weight: float
    is_failed: bool          # True → eligible for CAP creation
    is_critical: bool        # True → auto-fails whole audit if is_failed
    response_value: Optional[str]


@dataclass
class SectionScoreResult:
    section_id: str
    title: str
    weight: float
    max_possible: float
    achieved: float
    score_pct: float
    fields: list[FieldScoreResult]


@dataclass
class AuditScoreResult:
    overall_score: float          # 0–100 percentage
    passed: bool
    passing_score: float
    sections: list[SectionScoreResult]
    failed_fields: list[FieldScoreResult]  # fields that need CAPs


def _parse_response_value(value: Optional[str], field_type: str, max_score: float) -> tuple[float, bool]:
    """
    Convert a raw response string to a numeric score and a pass/fail flag.
    Returns (achieved_score, is_failed).

    Three-tier audit_item:
      compliant         → (max_score, False)
      needs_improvement → (max_score * 0.5, False)   ← partial, not a "fail"
      non_compliant     → (0.0, True)
    """
    if value is None or value.strip() == "":
        return 0.0, True

    v = value.strip().lower()

    # ── Three-tier audit item ─────────────────────────────────────────────────
    if field_type == "audit_item":
        ratio = AUDIT_ITEM_RATIOS.get(v)
        if ratio is None:
            return 0.0, True  # unrecognised value
        achieved = ratio * max_score
        is_failed = (ratio == 0.0)  # only non_compliant is a fail
        return achieved, is_failed

    # ── Binary yes/no / boolean ───────────────────────────────────────────────
    if field_type in ("boolean", "yes_no"):
        if v in ("true", "1", "yes", "pass", "ok"):
            return max_score, False
        return 0.0, True

    # ── Numeric ───────────────────────────────────────────────────────────────
    if field_type == "number":
        try:
            num = float(v)
            achieved = min(num, max_score)
            return achieved, achieved == 0.0
        except ValueError:
            return 0.0, True

    # ── Rating (1–5 stars) ────────────────────────────────────────────────────
    if field_type == "rating":
        try:
            num = float(v)
            achieved = (num / 5.0) * max_score
            return achieved, achieved < (max_score * 0.5)
        except ValueError:
            return 0.0, True

    if field_type in ("select", "radio"):
        if v in FAIL_VALUES:
            return 0.0, True
        return max_score, False

    # Default: non-empty = full score
    return max_score, False


async def calculate_audit_score(
    conn,
    submission_id: str,
    form_template_id: str,
    responses: list[dict],   # [{"field_id": str, "value": str}]
    org_id: str,
) -> AuditScoreResult:
    """
    Calculate the weighted score for an audit submission.
    Fetches template structure, section weights, field scores, and audit config
    from the database — never trusts client-supplied scores.
    """

    # ── 1. Load audit config (passing score) ──────────────────────────────
    cfg = row(
        conn,
        """
        SELECT passing_score
        FROM audit_configs
        WHERE form_template_id = %s
          AND is_deleted = FALSE
        LIMIT 1
        """,
        (form_template_id,),
    )
    passing_score = float(cfg["passing_score"]) if cfg else 80.0

    # ── 2. Load sections + fields (include is_critical) ───────────────────
    sections_data = rows(
        conn,
        """
        SELECT id, title, display_order
        FROM form_sections
        WHERE form_template_id = %s
          AND is_deleted = FALSE
        ORDER BY display_order
        """,
        (form_template_id,),
    )

    section_ids = [str(s["id"]) for s in sections_data]

    # Load all fields for these sections in one query
    fields_by_section: dict[str, list[dict]] = {sid: [] for sid in section_ids}
    if section_ids:
        all_fields = rows(
            conn,
            """
            SELECT id, form_section_id, label, field_type, display_order, is_critical
            FROM form_fields
            WHERE form_section_id = ANY(%s::uuid[])
              AND is_deleted = FALSE
            ORDER BY display_order
            """,
            (section_ids,),
        )
        for f in all_fields:
            sec_key = str(f["form_section_id"])
            if sec_key in fields_by_section:
                fields_by_section[sec_key].append(f)

    # ── 3. Load section weights ────────────────────────────────────────────
    section_weights: dict[str, float] = {}
    if section_ids:
        sw_rows = rows(
            conn,
            """
            SELECT section_id, weight
            FROM audit_section_weights
            WHERE section_id = ANY(%s::uuid[])
            """,
            (section_ids,),
        )
        section_weights = {str(r["section_id"]): float(r["weight"]) for r in sw_rows}

    # ── 4. Load field max scores ───────────────────────────────────────────
    all_field_ids = [str(f["id"]) for flist in fields_by_section.values() for f in flist]
    field_max_scores: dict[str, float] = {}
    if all_field_ids:
        fs_rows = rows(
            conn,
            """
            SELECT field_id, max_score
            FROM audit_field_scores
            WHERE field_id = ANY(%s::uuid[])
            """,
            (all_field_ids,),
        )
        field_max_scores = {str(r["field_id"]): float(r["max_score"]) for r in fs_rows}

    # ── 5. Build response lookup ───────────────────────────────────────────
    response_map: dict[str, str] = {
        r["field_id"]: r["value"] for r in responses
    }

    # ── 6. Score each section ──────────────────────────────────────────────
    section_results: list[SectionScoreResult] = []
    total_weighted_score = 0.0
    total_weight = 0.0

    for section in sections_data:
        sec_id = str(section["id"])
        sec_weight = section_weights.get(sec_id, 1.0)
        fields = fields_by_section.get(sec_id, [])

        field_results: list[FieldScoreResult] = []
        sec_max = 0.0
        sec_achieved = 0.0

        for field in sorted(fields, key=lambda f: f.get("display_order", 0)):
            fid = str(field["id"])
            ftype = field.get("field_type", "text")
            is_critical = bool(field.get("is_critical", False))

            # Evidence-only fields don't contribute to score
            if ftype in EVIDENCE_FIELD_TYPES:
                continue

            max_score = field_max_scores.get(fid, 1.0)
            raw_value = response_map.get(fid)
            achieved, is_failed = _parse_response_value(raw_value, ftype, max_score)

            weighted_achieved = achieved * sec_weight
            weighted_max = max_score * sec_weight

            sec_max += weighted_max
            sec_achieved += weighted_achieved

            field_results.append(FieldScoreResult(
                field_id=fid,
                label=field.get("label", ""),
                field_type=ftype,
                max_score=max_score,
                achieved_score=achieved,
                weight=sec_weight,
                is_failed=is_failed,
                is_critical=is_critical,
                response_value=raw_value,
            ))

        sec_pct = (sec_achieved / sec_max * 100) if sec_max > 0 else 100.0

        section_results.append(SectionScoreResult(
            section_id=sec_id,
            title=section.get("title", ""),
            weight=sec_weight,
            max_possible=sec_max,
            achieved=sec_achieved,
            score_pct=round(sec_pct, 2),
            fields=field_results,
        ))

        total_weighted_score += sec_achieved
        total_weight += sec_max

    # ── 7. Overall score ───────────────────────────────────────────────────
    overall_score = (total_weighted_score / total_weight * 100) if total_weight > 0 else 100.0
    overall_score = round(overall_score, 2)

    all_field_results = [f for s in section_results for f in s.fields]
    failed_fields = [f for f in all_field_results if f.is_failed]

    # Critical item auto-fail: any critical field that scored 0 forces passed=False
    critical_fail = any(f.is_critical and f.is_failed for f in all_field_results)
    passed = (overall_score >= passing_score) and not critical_fail

    return AuditScoreResult(
        overall_score=overall_score,
        passed=passed,
        passing_score=passing_score,
        sections=section_results,
        failed_fields=failed_fields,
    )


async def create_corrective_actions(
    conn,
    submission_id: str,
    failed_fields: list[FieldScoreResult],
    org_id: str,
    location_id: str,
    form_template_id: str = "",
    responses: list[dict] | None = None,
) -> dict | None:
    """
    Generate a Corrective Action Plan (CAP) with items for all failed fields.
    Called inside the submission transaction — if this fails, submission is rolled back.
    ``conn`` is a psycopg2 connection passed explicitly by the caller.
    """
    from services.cap_service import CAPService

    return await CAPService.generate_cap(
        conn,
        submission_id=submission_id,
        form_template_id=form_template_id,
        failed_fields=failed_fields,
        org_id=org_id,
        location_id=location_id,
        responses=responses,
    )
