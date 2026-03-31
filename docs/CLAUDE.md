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
