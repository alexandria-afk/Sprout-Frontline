import pytest
from fastapi.testclient import TestClient

# Patch settings before importing app so tests work without a real .env
import os
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "super-secret-jwt-token-with-at-least-32-characters-long")
os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:54322/postgres")

from main import app  # noqa: E402


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c
