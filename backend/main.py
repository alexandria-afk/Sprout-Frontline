import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from config import settings
from middleware.auth import AuthMiddleware
from middleware.logging import LoggingMiddleware
from routes import auth, users, organisations, forms, announcements, dashboard
from routes import audits, corrective_actions, workflows, reports, tasks, caps
from routes import notifications, issue_categories, vendors, issues, issue_dashboard
from routes import assets, repair_guides, safety
from routes import incidents
from routes import ai_generate
from routes import ai_insights
from routes import gamification
from routes import lms
from routes import audit_trail
from routes import shifts
from routes import onboarding
from routes import inbox
from routes import chat

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _reset_stuck_provisioning_sessions():
    """Reset any onboarding sessions that were left in 'provisioning' state by a server crash/restart."""
    try:
        import json
        from services.db import _get_pool, rows, execute
        pool = _get_pool()
        conn = pool.getconn()
        try:
            sessions = rows(conn, "SELECT id, launch_progress, updated_at FROM onboarding_sessions", ())
            cutoff = datetime.now(timezone.utc) - timedelta(minutes=2)
            reset_count = 0
            for s in sessions:
                progress = s.get("launch_progress") or {}
                if isinstance(progress, str):
                    progress = json.loads(progress)
                if progress.get("status") == "provisioning":
                    try:
                        updated_at = s.get("updated_at")
                        if updated_at and (updated_at if isinstance(updated_at, datetime) else datetime.fromisoformat(str(updated_at).replace("Z", "+00:00"))) < cutoff:
                            new_progress = json.dumps({**progress, "status": "failed", "error": "Provisioning was interrupted (server restart). Click Retry to try again."})
                            execute(conn, "UPDATE onboarding_sessions SET launch_progress = %s WHERE id = %s", (new_progress, s["id"]))
                            reset_count += 1
                    except Exception:
                        pass
            conn.commit()
        finally:
            pool.putconn(conn)
        if reset_count:
            logger.info(f"Reset {reset_count} stuck provisioning session(s) on startup.")
    except Exception as e:
        logger.warning(f"Could not reset stuck sessions on startup: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    _reset_stuck_provisioning_sessions()
    # Start scheduled reminder background task
    from services.reminder_service import run_reminder_loop
    reminder_task = asyncio.create_task(run_reminder_loop())
    logger.info("Scheduled reminder loop started.")
    try:
        yield
    finally:
        reminder_task.cancel()
        try:
            await reminder_task
        except asyncio.CancelledError:
            pass


limiter = Limiter(key_func=get_remote_address, default_limits=[f"{settings.rate_limit_per_minute}/minute"])

app = FastAPI(
    lifespan=lifespan,
    title="Frontliner API",
    version="1.0.0",
    description="Frontliner Operations Platform — Phase 1",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)
app.add_middleware(LoggingMiddleware)

app.include_router(auth.router,          prefix="/api/v1/auth",          tags=["auth"])
app.include_router(users.router,         prefix="/api/v1/users",         tags=["users"])
app.include_router(organisations.router, prefix="/api/v1/organisations", tags=["organisations"])
app.include_router(forms.router,         prefix="/api/v1/forms",         tags=["forms"])
app.include_router(announcements.router, prefix="/api/v1/announcements", tags=["announcements"])
app.include_router(dashboard.router,          prefix="/api/v1/dashboard",           tags=["dashboard"])
app.include_router(audits.router,             prefix="/api/v1/audits",              tags=["audits"])
app.include_router(corrective_actions.router, prefix="/api/v1/corrective-actions",  tags=["corrective-actions"])
app.include_router(caps.router,                  prefix="/api/v1/caps",                tags=["caps"])
app.include_router(workflows.router,          prefix="/api/v1/workflows",           tags=["workflows"])
app.include_router(reports.router,            prefix="/api/v1/reports",             tags=["reports"])
app.include_router(tasks.router,              prefix="/api/v1/tasks",               tags=["tasks"])

# Phase 3 — Issues, Maintenance, Vendors, Safety
app.include_router(notifications.router,     prefix="/api/v1/notifications",       tags=["notifications"])
app.include_router(issue_categories.router,  prefix="/api/v1/issues/categories",   tags=["issue-categories"])
app.include_router(issue_dashboard.router,   prefix="/api/v1/issues/dashboard",    tags=["issue-dashboard"])
app.include_router(issues.router,            prefix="/api/v1/issues",              tags=["issues"])
app.include_router(vendors.router,           prefix="/api/v1/vendors",             tags=["vendors"])
app.include_router(assets.router,            prefix="/api/v1/assets",              tags=["assets"])
app.include_router(repair_guides.router,     prefix="/api/v1/repair-guides",       tags=["repair-guides"])
app.include_router(safety.router,            prefix="/api/v1/safety",              tags=["safety"])
app.include_router(incidents.router,         prefix="/api/v1/incidents",           tags=["incidents"])
app.include_router(ai_generate.router,       prefix="/api/v1/ai",                  tags=["ai"])
app.include_router(ai_insights.router,       prefix="/api/v1/ai",                  tags=["ai-insights"])
app.include_router(gamification.router,      prefix="/api/v1/gamification",        tags=["gamification"])
app.include_router(lms.router,               prefix="/api/v1/lms",                 tags=["lms"])
app.include_router(audit_trail.router,       prefix="/api/v1/settings",            tags=["Audit Trail"])
app.include_router(shifts.router,            prefix="/api/v1/shifts",              tags=["shifts"])
app.include_router(onboarding.router,        prefix="/api/v1/onboarding",          tags=["onboarding"])
app.include_router(inbox.router,             prefix="/api/v1/inbox",               tags=["inbox"])
app.include_router(chat.router,              prefix="/api/v1/chat",                tags=["chat"])


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "environment": settings.environment}
