import logging
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
from routes import assets, repair_guides, maintenance, safety
from routes import incidents
from routes import ai_generate
from routes import gamification
from routes import lms
from routes import audit_trail

logging.basicConfig(level=logging.INFO)

limiter = Limiter(key_func=get_remote_address, default_limits=[f"{settings.rate_limit_per_minute}/minute"])

app = FastAPI(
    title="Frontline API",
    version="1.0.0",
    description="Frontline Operations Platform — Phase 1",
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
app.include_router(maintenance.router,       prefix="/api/v1/maintenance",         tags=["maintenance"])
app.include_router(safety.router,            prefix="/api/v1/safety",              tags=["safety"])
app.include_router(incidents.router,         prefix="/api/v1/incidents",           tags=["incidents"])
app.include_router(ai_generate.router,       prefix="/api/v1/ai",                  tags=["ai"])
app.include_router(gamification.router,      prefix="/api/v1/gamification",        tags=["gamification"])
app.include_router(lms.router,               prefix="/api/v1/lms",                 tags=["lms"])
app.include_router(audit_trail.router,       prefix="/api/v1/settings",            tags=["Audit Trail"])


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "environment": settings.environment}
