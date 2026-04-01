# AI Daily Brief & Insights Spec

**Powers the dashboard brief on web and insight cards on mobile.**

---

## Overview

The AI Daily Brief system gathers operational data across the entire platform, sends it to Claude for pattern analysis, and surfaces maximum 3 actionable insights. It's not a summary of counts — it's intelligence.

Two endpoints:
- `GET /api/v1/ai/daily-snapshot` — pure SQL aggregation, no AI
- `GET /api/v1/ai/dashboard-insights` — calls snapshot, sends to Claude, returns brief + insights

---

## Daily Snapshot Endpoint

`GET /api/v1/ai/daily-snapshot`

Pure SQL aggregation. No Claude call. Returns rich operational data for AI analysis. Cached per org per day — regenerate on first request after midnight or on manual refresh (?refresh=true).

### Data Gathered

**Certification & Training:**
- Expiring certifications grouped by location (7, 14, 30 day windows)
- Per-location training completion rates
- Overdue enrollments (past deadline, not completed)
- New hires with incomplete required training

**Issue Resolution:**
- Per-category: average resolution time vs sla_hours, trailing 4 weeks (weekly buckets)
- Categories where avg resolution > 2x SLA for 2+ consecutive weeks
- Recurring issues: same category + location appearing 3+ times in 30 days
- SLA breach count this week vs last week

**Audits & Compliance:**
- Per-location: average audit scores for last 4 weeks (weekly)
- Locations with scores declining 3+ consecutive weeks
- Unreviewed CAPs (status = pending_review) with age in days
- Failed audit count this week

**Checklists:**
- Per-location: daily completion rates for last 7 days
- Locations below 80% completion for 2+ consecutive days
- Per-template: completion rate trend (this week vs last week)

**Pull-Outs & Waste:**
- Per-location per-category: weekly cost for last 4 weeks
- Anomalies (current week > 1.5x of 4-week rolling average)
- Top 5 items by cost this week with reason breakdown

**Shifts & Attendance:**
- Per-location: scheduled vs clocked-in for trailing 7 days
- No-show count this week vs last week
- Open shifts unfilled
- Overtime hours by location this week
- Present rate, on-time rate, utilization rate per location

**Tasks:**
- Per-location: completion rate this week vs last week
- Tasks open > 7 days (count and titles)
- Overdue count trend (this week vs last week)

**Maintenance (issues where category.is_maintenance = true):**
- Open count
- Total cost this month vs last month
- Assets with 3+ issues in 30 days

**Incidents:**
- Count this week
- Open unresolved

**Location Scorecard (per location, last 4 weeks):**
- Checklist completion rate trend
- Audit score trend
- Issue count trend
- Pull-out cost trend
- Training completion rate
- Attendance rate trend

**Cross-Module:**
- Locations where 3+ metrics are declining simultaneously
- New hires on shifts who haven't completed required training
- Correlation: locations with low checklist completion AND rising issue counts

Returns structured JSON. Can be 5-10KB. Cached daily.

---

## Insight Generation Endpoint

`GET /api/v1/ai/dashboard-insights`

### Flow

1. Call daily-snapshot for raw data
2. Filter by role before sending to Claude:
   - Staff: their location only, their personal data
   - Manager: their location(s), their team
   - Admin: all locations, cross-location comparisons
3. Send filtered data to Claude
4. Cache response per org + role level per day
5. Manual refresh via ?refresh=true

### Claude System Prompt

```
You are an operations intelligence analyst for a 
{industry_code} business with {location_count} locations.

Analyze the operational data and identify ONLY what the 
user absolutely needs to know today. Maximum 3 insights.

Rules:
- If nothing is notably wrong, return 1 INFO insight 
  about what's going well. Don't invent problems.
- Only flag something as CRITICAL if it requires action 
  TODAY or there's a compliance/safety risk.
- Only flag WARNING if the trend has been wrong for 2+ 
  weeks and nobody has acted on it.
- Don't report on things that are slightly off. Only 
  patterns that are meaningfully wrong or meaningfully good.
- If you can't find 3 real insights, return fewer. 
  1 is fine. 0 is fine — return empty array.
- Each insight must be a pattern, not a count. 
  Cross-reference multiple data points where possible.
- Be specific: name locations, percentages, timeframes.
- End each with a recommendation starting with →

Return JSON:
{
  "brief": "2-3 sentence executive summary",
  "insights": [
    {
      "severity": "critical|warning|info",
      "title": "Short headline under 15 words",
      "body": "2-3 sentences with specifics",
      "recommendation": "→ Concrete next step"
    }
  ]
}
```

### Response Example

```json
{
  "brief": "Pasay has 8 Food Safety certifications expiring in 14 days affecting 40% of frontline staff. BGC continues to lead composite scores for the third consecutive month.",
  "insights": [
    {
      "severity": "critical",
      "title": "8 certifications expiring at Pasay in 14 days",
      "body": "Pasay Branch has 8 staff whose Food Safety certifications expire within 14 days — 40% of the frontline team.",
      "recommendation": "→ Schedule a group renewal session this week."
    },
    {
      "severity": "warning",
      "title": "Food Safety resolution averaging 3× over SLA",
      "body": "Food Safety issues are averaging 3.1 hours to resolve against a 2-hour SLA — consistent for 3 weeks.",
      "recommendation": "→ Review escalation rules and confirm current assignees have authority to act."
    },
    {
      "severity": "info",
      "title": "BGC Branch leading composite score 3 months running",
      "body": "BGC Branch has ranked #1 in composite score for 3 consecutive months. Checklist completion 96%, audit pass rate 94%.",
      "recommendation": "→ Document BGC practices and share as a best-practice template with Pasay and QC."
    }
  ]
}
```

---

## Where Insights Surface

### Web Dashboard: Daily Brief (manager + admin only)

- Shows at top of dashboard, before stat cards
- Brief paragraph displayed as text
- ✦ sparkle icon in section header
- Collapsible
- "Refresh" button → calls endpoint with ?refresh=true
- Below the brief, show insight cards:
  - 🔴 CRITICAL — red left accent
  - ⚠️ WARNING — orange left accent
  - ℹ️ INFO — blue left accent
  - Each: severity badge + title (bold) + body + recommendation
- If no insights: just show brief paragraph, no cards
- Not shown for staff on web

### Mobile Dashboard: AI Insight Cards (all roles)

Per docs/MOBILE_DESIGN.md Pattern 2.

- Source: insights array from this endpoint
- Show below stat cards, above My Shift
- Only render when insights exist
- Each card: surface-1 bg, 12px radius, 16px padding
- Severity indicator: 🔴 / ⚠️ / ℹ️
- Title bold + body + recommendation
- Swipe right to dismiss
- Dismissed IDs stored locally (Hive) with today's date, cleared daily
- The brief text is NOT shown separately on mobile — the cards ARE the mobile brief

### Insights Page (web)

The existing insights/sidekick insights page uses the same endpoint. Same data as the dashboard brief.

- "Refresh" button
- Filter by severity
- Dashboard and insights page share the same cached data

---

## Sidekick Chat Context

When a user asks the AI chat (`POST /api/v1/ai/chat`) about operations or performance, include the latest daily snapshot in the chat context.

Detect relevant queries: "how are we doing", "any problems", "what should I focus on", "operations summary", "performance", "any issues", "what's going on"

This lets the sidekick answer with specific numbers from the snapshot rather than generic responses.

---

## Validation

- [ ] Daily snapshot returns rich data across all modules
- [ ] Snapshot cached per org per day
- [ ] Snapshot refreshes after midnight or on manual refresh
- [ ] Insights endpoint returns brief + max 3 insights
- [ ] Insights are patterns, not counts
- [ ] Insights cross-reference multiple data points
- [ ] Each insight has severity, title, body, recommendation
- [ ] Returns fewer than 3 (or 0) when nothing notable
- [ ] Role filtering works (staff personal, manager location, admin all)
- [ ] Web daily brief shows at top of manager/admin dashboard
- [ ] Brief is collapsible with refresh button
- [ ] Insight cards show below brief with severity colors
- [ ] Mobile insight cards render only when insights exist
- [ ] Mobile cards dismissable with swipe right
- [ ] Dismissed cards don't return same day
- [ ] Insights page uses same endpoint
- [ ] Sidekick chat includes snapshot for ops questions
- [ ] Cache works per org + role level per day
