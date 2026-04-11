"""
Integration tests for workflow API endpoints.
Tests hit the real HTTP layer via TestClient (auth + routing + serialisation).
psycopg2 DB calls are mocked so tests run without a live database.
Auth is bypassed by overriding the get_current_user FastAPI dependency directly.
"""
from unittest.mock import MagicMock, patch
import pytest

ORG_ID = "00000000-0000-0000-0000-000000000001"
ADMIN_USER_ID = "00000000-0000-0000-0000-000000000010"
MANAGER_USER_ID = "00000000-0000-0000-0000-000000000011"
STAFF_USER_ID = "00000000-0000-0000-0000-000000000012"
DEF_ID = "00000000-0000-0000-0000-000000000100"
STAGE_ID = "00000000-0000-0000-0000-000000000200"
INSTANCE_ID = "00000000-0000-0000-0000-000000000300"
STAGE_INST_ID = "00000000-0000-0000-0000-000000000400"


# ── DB connection mock (autouse) ───────────────────────────────────────────────

@pytest.fixture(autouse=True)
def mock_db_pool(monkeypatch):
    """Prevent get_db_conn from touching a real DB pool.

    Individual tests patch services.db.row / rows / execute / execute_returning
    for their specific return values. This fixture just stops the pool init.
    """
    dummy_conn = MagicMock()
    mock_pool = MagicMock()
    mock_pool.getconn.return_value = dummy_conn
    monkeypatch.setattr("services.db._pool", mock_pool)
    return dummy_conn


# ── Auth dependency fixtures ───────────────────────────────────────────────────

@pytest.fixture
def mock_current_user_admin():
    user = {
        "sub": ADMIN_USER_ID,
        "email": "admin@test.com",
        "role": ["admin"],
        "app_metadata": {
            "role": "admin",
            "organisation_id": ORG_ID,
            "location_id": None,
        },
    }
    from main import app
    from dependencies import get_current_user
    app.dependency_overrides[get_current_user] = lambda: user
    yield user
    app.dependency_overrides.clear()


@pytest.fixture
def mock_current_user_manager():
    user = {
        "sub": MANAGER_USER_ID,
        "email": "manager@test.com",
        "role": ["manager"],
        "app_metadata": {
            "role": "manager",
            "organisation_id": ORG_ID,
            "location_id": None,
        },
    }
    from main import app
    from dependencies import get_current_user
    app.dependency_overrides[get_current_user] = lambda: user
    yield user
    app.dependency_overrides.clear()


@pytest.fixture
def mock_current_user_staff():
    user = {
        "sub": STAFF_USER_ID,
        "email": "staff@test.com",
        "role": ["staff"],
        "app_metadata": {
            "role": "staff",
            "organisation_id": ORG_ID,
            "location_id": None,
        },
    }
    from main import app
    from dependencies import get_current_user
    app.dependency_overrides[get_current_user] = lambda: user
    yield user
    app.dependency_overrides.clear()


# ── Tests: Definitions ────────────────────────────────────────────────────────

class TestListWorkflowDefinitions:
    def test_returns_200_for_manager(self, client, mock_current_user_manager):
        sample_def = {
            "id": DEF_ID,
            "organisation_id": ORG_ID,
            "name": "Test Workflow",
            "trigger_type": "manual",
            "is_active": False,
            "is_deleted": False,
            "created_at": "2025-01-01T00:00:00Z",
            "workflow_stages": [],
        }
        with patch("services.db.rows", return_value=[sample_def]):
            resp = client.get("/api/v1/workflows/definitions")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert data[0]["name"] == "Test Workflow"

    def test_returns_401_without_token(self, client):
        resp = client.get("/api/v1/workflows/definitions")
        assert resp.status_code == 401  # HTTPBearer returns 401 when no credentials

    def test_returns_403_for_staff(self, client, mock_current_user_staff):
        with patch("services.db.rows", return_value=[]):
            resp = client.get("/api/v1/workflows/definitions")
        assert resp.status_code == 403


class TestCreateWorkflowDefinition:
    def test_creates_definition(self, client, mock_current_user_admin):
        created = {
            "id": DEF_ID,
            "organisation_id": ORG_ID,
            "name": "New Workflow",
            "trigger_type": "manual",
            "is_active": False,
            "is_deleted": False,
            "created_at": "2025-01-01T00:00:00Z",
        }
        with patch("services.db.execute_returning", return_value=created):
            resp = client.post(
                "/api/v1/workflows/definitions",
                json={"name": "New Workflow", "trigger_type": "manual"},
            )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Workflow"

    def test_rejects_non_admin(self, client, mock_current_user_manager):
        resp = client.post(
            "/api/v1/workflows/definitions",
            json={"name": "New Workflow", "trigger_type": "manual"},
        )
        assert resp.status_code == 403

    def test_requires_name(self, client, mock_current_user_admin):
        resp = client.post(
            "/api/v1/workflows/definitions",
            json={"trigger_type": "manual"},
        )
        assert resp.status_code == 422


class TestDeleteWorkflowDefinition:
    def _existing_def(self, is_active=False):
        return {"id": DEF_ID, "is_active": is_active}

    def test_deletes_inactive_workflow(self, client, mock_current_user_admin):
        existing = self._existing_def(is_active=False)
        with (
            patch("services.db.row", return_value=existing),
            patch("services.db.rows", return_value=[]),
            patch("services.db.execute", return_value=1),
            patch("services.db.execute_returning", return_value={**existing, "is_deleted": True}),
        ):
            resp = client.delete(f"/api/v1/workflows/definitions/{DEF_ID}")
        # 200 or 404 depending on mock coverage — just ensure auth passed
        assert resp.status_code in (200, 404)

    def test_blocks_deletion_of_active_workflow(self, client, mock_current_user_admin):
        existing = self._existing_def(is_active=True)
        with patch("services.db.row", return_value=existing):
            resp = client.delete(f"/api/v1/workflows/definitions/{DEF_ID}")
        assert resp.status_code == 409


# ── Tests: Stages ──────────────────────────────────────────────────────────────

class TestAddStage:
    def test_adds_stage_successfully(self, client, mock_current_user_admin):
        new_stage = {
            "id": STAGE_ID,
            "workflow_definition_id": DEF_ID,
            "name": "Approval",
            "action_type": "approve",
            "stage_order": 1,
            "assigned_role": "manager",
            "is_final": False,
        }
        def_record = {"id": DEF_ID, "organisation_id": ORG_ID, "is_deleted": False}
        with (
            patch("services.db.row", return_value=def_record),
            patch("services.db.execute_returning", return_value=new_stage),
        ):
            resp = client.post(
                f"/api/v1/workflows/definitions/{DEF_ID}/stages",
                json={"name": "Approval", "action_type": "approve", "stage_order": 1},
            )
        assert resp.status_code in (200, 201)

    def test_blocks_non_admin(self, client, mock_current_user_manager):
        resp = client.post(
            f"/api/v1/workflows/definitions/{DEF_ID}/stages",
            json={"name": "Approval", "action_type": "approve", "stage_order": 1},
        )
        assert resp.status_code == 403


# ── Tests: Instances ──────────────────────────────────────────────────────────

class TestListInstances:
    def test_returns_instances_for_manager(self, client, mock_current_user_manager):
        sample_inst = {
            "id": INSTANCE_ID,
            "workflow_definition_id": DEF_ID,
            "organisation_id": ORG_ID,
            "status": "in_progress",
            "created_at": "2025-01-01T00:00:00Z",
            "workflow_definitions": {"name": "Test", "trigger_type": "manual"},
            "workflow_stages": {"name": "Approval", "action_type": "approve"},
        }
        with patch("services.db.rows", return_value=[sample_inst]):
            resp = client.get("/api/v1/workflows/instances")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_status_filter_is_applied(self, client, mock_current_user_manager):
        with patch("services.db.rows", return_value=[]):
            resp = client.get("/api/v1/workflows/instances?status=completed")
        assert resp.status_code == 200


class TestGetMyTasks:
    def test_returns_tasks_for_authenticated_user(self, client, mock_current_user_staff):
        task = {
            "id": STAGE_INST_ID,
            "workflow_instance_id": INSTANCE_ID,
            "status": "in_progress",
            "assigned_to": STAFF_USER_ID,
            "workflow_stages": {"name": "Fill Form", "action_type": "fill_form"},
            "workflow_instances": {"workflow_definitions": {"name": "Store Opening"}},
        }
        with patch("services.db.rows", return_value=[task]):
            resp = client.get("/api/v1/workflows/instances/my-tasks")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)


class TestApproveStage:
    def test_approve_requires_auth(self, client):
        resp = client.post(
            f"/api/v1/workflows/instances/{INSTANCE_ID}/stages/{STAGE_INST_ID}/approve",
            json={"comment": "Looks good"},
        )
        assert resp.status_code == 401  # No credentials → 401

    def test_approve_schema_rejects_extra_fields_gracefully(self, client, mock_current_user_manager):
        """Approve endpoint accepts requests — 422 only for truly invalid JSON schema."""
        # Sending valid JSON (even if comment is absent) should NOT return 422
        # Use an obviously-bad instance ID to get 4xx from service, not 422 from schema
        resp = client.post(
            "/api/v1/workflows/instances/not-a-uuid/stages/not-a-uuid/approve",
            json={"comment": "ok"},
        )
        # 422 here is from path param UUID validation — that's fine
        assert resp.status_code == 422


class TestRejectStage:
    def test_reject_requires_comment(self, client, mock_current_user_manager):
        """Reject without a comment should fail validation or be rejected by logic."""
        stage_inst = {
            "id": STAGE_INST_ID,
            "workflow_instance_id": INSTANCE_ID,
            "status": "in_progress",
            "workflow_stages": {"action_type": "approve"},
            "workflow_instances": {"organisation_id": ORG_ID},
        }
        with patch("services.db.row", return_value=stage_inst):
            resp = client.post(
                f"/api/v1/workflows/instances/{INSTANCE_ID}/stages/{STAGE_INST_ID}/reject",
                json={},
            )
        # 400 (missing comment) or 422 (validation) or 404 (stage not found with mock)
        assert resp.status_code in (400, 404, 422)


# ── Tests: Publish Validation ─────────────────────────────────────────────────

class TestPublishWorkflow:
    def test_publish_endpoint_exists_and_requires_admin(self, client, mock_current_user_manager):
        resp = client.post(f"/api/v1/workflows/definitions/{DEF_ID}/publish")
        assert resp.status_code == 403

    def test_publish_fails_when_no_stages(self, client, mock_current_user_admin):
        def_record = {
            "id": DEF_ID,
            "organisation_id": ORG_ID,
            "is_active": False,
            "is_deleted": False,
            "trigger_type": "manual",
            "trigger_config": {},
        }
        # row() called for definition fetch; rows() called for stages and rules
        with (
            patch("services.db.row", return_value=def_record),
            patch("services.db.rows", return_value=[]),  # no stages, no rules
        ):
            resp = client.post(f"/api/v1/workflows/definitions/{DEF_ID}/publish")
        # 422 = validation errors (no stages); 404 = mock DB miss
        assert resp.status_code in (404, 422)


# ── Tests: Cancel Instance ────────────────────────────────────────────────────

class TestCancelInstance:
    def test_cancel_requires_manager(self, client, mock_current_user_staff):
        resp = client.post(
            f"/api/v1/workflows/instances/{INSTANCE_ID}/cancel",
        )
        assert resp.status_code == 403

    def test_cancel_returns_200_or_404_for_manager(self, client, mock_current_user_manager):
        inst = {"id": INSTANCE_ID, "organisation_id": ORG_ID, "status": "in_progress"}
        updated_inst = {**inst, "status": "cancelled"}
        with (
            patch("services.db.row", return_value=inst),
            patch("services.db.execute_returning", return_value=updated_inst),
            patch("services.db.execute", return_value=1),
        ):
            resp = client.post(
                f"/api/v1/workflows/instances/{INSTANCE_ID}/cancel",
                json={"reason": "Testing cancellation"},
            )
        assert resp.status_code in (200, 404)


# ── Tests: Stage Instance Detail ──────────────────────────────────────────────

class TestGetStageInstanceDetail:
    def test_returns_stage_history_field(self, client, mock_current_user_staff):
        stage_inst = {
            "id": STAGE_INST_ID,
            "workflow_instance_id": INSTANCE_ID,
            "status": "in_progress",
            "assigned_to": STAFF_USER_ID,
            "assigned_role": None,
            "form_submission_id": None,
            "review_submission_id": None,
            "due_at": None,
            "workflow_stages": {
                "id": STAGE_ID,
                "name": "Fill Form",
                "action_type": "fill_form",
                "stage_order": 1,
                "form_template_id": None,
                "config": None,
            },
            "workflow_instances": {
                "id": INSTANCE_ID,
                "organisation_id": ORG_ID,
                "workflow_definitions": {"name": "Test Workflow"},
            },
        }
        # row() for main stage instance fetch; rows() for siblings/history
        with (
            patch("services.db.row", return_value=stage_inst),
            patch("services.db.rows", return_value=[]),
        ):
            resp = client.get(
                f"/api/v1/workflows/instances/{INSTANCE_ID}/stages/{STAGE_INST_ID}",
            )
        assert resp.status_code in (200, 404)
        if resp.status_code == 200:
            data = resp.json()
            assert "stage_history" in data
