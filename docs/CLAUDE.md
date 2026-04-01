# CLAUDE.md

## Project
Sprout Field Ops — frontline operations platform for QSR, retail, hospitality, and logistics.

## Stack
- Web: Next.js 14 (App Router), TypeScript, Tailwind, React Query, Zustand
- Backend: FastAPI (Python 3.13), Pydantic, Supabase (Postgres 17, Auth, Storage, Realtime)
- Mobile: Flutter 3.x, Riverpod, Go Router, Dio, Hive
- AI: Anthropic Claude (claude-haiku-4-5) via custom abstraction layer
- QA: Playwright (E2E), pytest (backend)

## Key Docs
- `docs/ARCHITECTURE.md` — full codebase reference (tables, routes, pages, integrations)
- `docs/ALLOWED_VALUES.md` — constrained enum values for workflows, courses, AI generation

## Conventions
- Soft deletes: `is_deleted BOOLEAN DEFAULT false` on all entities
- Multi-tenancy: every table has `organisation_id`
- RLS enabled on all tables; backend uses service role key
- Roles: super_admin, admin, manager, staff
- All AI calls logged to `ai_request_log`
- No direct AI SDK calls from frontend — all AI goes through FastAPI

## Before You Build
- Read `docs/ARCHITECTURE.md` for current state before making changes
- Read `docs/ALLOWED_VALUES.md` before touching workflows, courses, AI prompts, or seed data
- Check `supabase/migrations/` for the latest migration number before creating new ones

## Roles & Permissions (enforce everywhere)

Four roles: super_admin, admin, manager, staff

Staff can ONLY:
- View and complete their own assigned tasks, forms, checklists
- Report issues
- View their own shifts, clock in/out, claim open shifts
- Take training courses
- View announcements and acknowledge
- View their own badges and points
- Submit leave requests
- Use AI chat

Staff can NEVER see:
- Other people's tasks or assignments
- Team/attendance views
- Approval screens (workflow, shift swap, leave approvals)
- User management
- Settings/admin pages
- Analytics/reports/insights
- Workflow builder
- Issue categories editor
- Template creation or management

Manager can do everything staff can, plus:
- View their team's tasks, issues, attendance
- Approve/reject (workflow stages, shift swaps, leave, open shift claims)
- Assign tasks and forms
- Run audits
- Create announcements
- View reports for their location

Admin/Super Admin can do everything manager can, plus:
- All locations (not just their own)
- User management
- Settings and configuration
- Workflow builder
- Template management
- Full analytics and insights

EVERY screen, tab, nav item, and button must check the user's 
role before rendering. If a component is not listed for a role 
above, it must be hidden — not disabled, hidden.