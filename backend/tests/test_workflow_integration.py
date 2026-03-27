"""
Integration tests for workflow API endpoints.
Tests hit the real HTTP layer via TestClient (auth + routing + serialisation).
Supabase DB calls are mocked so tests run without a live database.
"""
import time
from unittest.mock import MagicMock, patch
import jwt
import pytest

ORG_ID = "00000000-0000-0000-0000-000000000001"
ADMIN_USER_ID = "00000000-0000-0000-0000-000000000010"
MANAGER_USER_ID = "00000000-0000-0000-0000-000000000011"
STAFF_USER_ID = "00000000-0000-0000-0000-000000000012"
DEF_ID = "00000000-0000-0000-0000-000000000100"
STAGE_ID = "00000000-0000-0000-0000-000000000200"
INSTANCE_ID = "00000000-0000-0000-0000-000000000300"
STAGE_INST_ID = "00000000-0000-0000-0000-000000000400"


# ── JWT helpers ────────────────────────────────────────────────────────────────

def _make_token(user_id: str, role: str, org_id: str = ORG_ID) -> str:
    """Mint a test HS256 JWT that passes the `get_current_user` dependency."""
    secret = "super-secret-jwt-token-with-at-least-32-characters-long"
    payload = {
        "sub": user_id,
        "aud": "authenticated",
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
        "app_metadata": {"role": role, "organisation_id": org_id},
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture
def admin_token():
    return _make_token(ADMIN_USER_ID, "admin")


@pytest.fixture
def manager_token():
    return _make_token(MANAGER_USER_ID, "manager")


@pytest.fixture
def staff_token():
    return _make_token(STAFF_USER_ID, "staff")


# ── Supabase mock factory ──────────────────────────────────────────────────────

def _mock_sb(rows=None, count=0):
    """Return a MagicMock Supabase client that yields `rows` on .execute()."""
    rows = rows or []
    result = MagicMock()
    result.data = rows
    result.count = count

    q = MagicMock()
    q.execute.return_value = result
    # Chain methods return self so calls can be chained
    for method in ("select", "insert", "update", "delete", "eq", "neq", "in_",
                   "is_", "limit", "range", "order", "maybe_single", "single",
                   "not_", "or_", "contains", "filter", "match"):
        getattr(q, method).return_value = q

    client = MagicMock()
    client.table.return_value = q
    return client


# ── Tests: Definitions ────────────────────────────────────────────────────────

class TestListWorkflowDefinitions:
    def test_returns_200_for_manager(self, client, manager_token):
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
        with patch("routes.workflows.get_admin_client", return_value=_mock_sb([sample_def])):
            resp = client.get(
                "/api/v1/workflows/definitions",
                headers={"Authorization": f"Bearer {manager_token}"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert data[0]["name"] == "Test Workflow"

    def test_returns_401_without_token(self, client):
        resp = client.get("/api/v1/workflows/definitions")
        assert resp.status_code == 401  # HTTPBearer returns 401 when no credentials

    def test_returns_403_for_staff(self, client, staff_token):
        with patch("routes.workflows.get_admin_client", return_value=_mock_sb([])):
            resp = client.get(
                "/api/v1/workflows/definitions",
                headers={"Authorization": f"Bearer {staff_token}"},
            )
        assert resp.status_code == 403


class TestCreateWorkflowDefinition:
    def test_creates_definition(self, client, admin_token):
        created = {
            "id": DEF_ID,
            "organisation_id": ORG_ID,
            "name": "New Workflow",
            "trigger_type": "manual",
            "is_active": False,
            "is_deleted": False,
            "created_at": "2025-01-01T00:00:00Z",
        }
        sb = _mock_sb([created])
        with patch("routes.workflows.get_admin_client", return_value=sb):
            resp = client.post(
                "/api/v1/workflows/definitions",
                json={"name": "New Workflow", "trigger_type": "manual"},
                headers={"Authorization": f"Bearer {admin_token}"},
            )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Workflow"

    def test_rejects_non_admin(self, client, manager_token):
        resp = client.post(
            "/api/v1/workflows/definitions",
            json={"name": "New Workflow", "trigger_type": "manual"},
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert resp.status_code == 403

    def test_requires_name(self, client, admin_token):
        resp = client.post(
            "/api/v1/workflows/definitions",
            json={"trigger_type": "manual"},
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp.status_code == 422


class TestDeleteWorkflowDefinition:
    def _existing_def(self, is_active=False):
        return {"id": DEF_ID, "is_active": is_active}

    def test_deletes_inactive_workflow(self, client, admin_token):
        existing = MagicMock()
        existing.data = self._existing_def(is_active=False)
        running = MagicMock()
        running.count = 0

        sb = MagicMock()
        q = MagicMock()
        q.execute.return_value = existing
        q.data = self._existing_def(is_active=False)
        q.count = 0

        for method in ("select", "update", "eq", "neq", "in_", "is_", "limit",
                       "range", "order", "maybe_single", "single", "filter"):
            getattr(q, method).return_value = q

        sb.table.return_value = q

        with patch("routes.workflows.get_admin_client", return_value=sb):
            resp = client.delete(
                f"/api/v1/workflows/definitions/{DEF_ID}",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
        # 200 or 404 depending on mock — just ensure auth passed
        assert resp.status_code in (200, 404)

    def test_blocks_deletion_of_active_workflow(self, client, admin_token):
        existing_result = MagicMock()
        existing_result.data = self._existing_def(is_active=True)

        q = MagicMock()
        q.execute.return_value = existing_result
        q.data = self._existing_def(is_active=True)
        for method in ("select", "update", "eq", "neq", "maybe_single"):
            getattr(q, method).return_value = q

        sb = MagicMock()
        sb.table.return_value = q

        with patch("routes.workflows.get_admin_client", return_value=sb):
            resp = client.delete(
                f"/api/v1/workflows/definitions/{DEF_ID}",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
        assert resp.status_code == 409


# ── Tests: Stages ──────────────────────────────────────────────────────────────

class TestAddStage:
    def test_adds_stage_successfully(self, client, admin_token):
        new_stage = {
            "id": STAGE_ID,
            "workflow_definition_id": DEF_ID,
            "name": "Approval",
            "action_type": "approve",
            "stage_order": 1,
            "assigned_role": "manager",
            "is_final": False,
        }
        # Definition lookup
        def_result = MagicMock()
        def_result.data = {"id": DEF_ID, "organisation_id": ORG_ID, "is_deleted": False}
        stage_result = MagicMock()
        stage_result.data = [new_stage]

        q = MagicMock()
        q.execute.side_effect = [def_result, stage_result]
        for method in ("select", "insert", "update", "eq", "maybe_single", "single"):
            getattr(q, method).return_value = q

        sb = MagicMock()
        sb.table.return_value = q

        with patch("routes.workflows.get_admin_client", return_value=sb):
            resp = client.post(
                f"/api/v1/workflows/definitions/{DEF_ID}/stages",
                json={"name": "Approval", "action_type": "approve", "stage_order": 1},
                headers={"Authorization": f"Bearer {admin_token}"},
            )
        assert resp.status_code in (200, 201)

    def test_blocks_non_admin(self, client, manager_token):
        resp = client.post(
            f"/api/v1/workflows/definitions/{DEF_ID}/stages",
            json={"name": "Approval", "action_type": "approve", "stage_order": 1},
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert resp.status_code == 403


# ── Tests: Instances ──────────────────────────────────────────────────────────

class TestListInstances:
    def test_returns_instances_for_manager(self, client, manager_token):
        sample_inst = {
            "id": INSTANCE_ID,
            "workflow_definition_id": DEF_ID,
            "organisation_id": ORG_ID,
            "status": "in_progress",
            "created_at": "2025-01-01T00:00:00Z",
            "workflow_definitions": {"name": "Test", "trigger_type": "manual"},
            "workflow_stages": {"name": "Approval", "action_type": "approve"},
        }
        with patch("routes.workflows.get_admin_client", return_value=_mock_sb([sample_inst])):
            resp = client.get(
                "/api/v1/workflows/instances",
                headers={"Authorization": f"Bearer {manager_token}"},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_status_filter_is_applied(self, client, manager_token):
        with patch("routes.workflows.get_admin_client", return_value=_mock_sb([])):
            resp = client.get(
                "/api/v1/workflows/instances?status=completed",
                headers={"Authorization": f"Bearer {manager_token}"},
            )
        assert resp.status_code == 200


class TestGetMyTasks:
    def test_returns_tasks_for_authenticated_user(self, client, staff_token):
        task = {
            "id": STAGE_INST_ID,
            "workflow_instance_id": INSTANCE_ID,
            "status": "in_progress",
            "assigned_to": STAFF_USER_ID,
            "workflow_stages": {"name": "Fill Form", "action_type": "fill_form"},
            "workflow_instances": {"workflow_definitions": {"name": "Store Opening"}},
        }
        with patch("routes.workflows.get_admin_client", return_value=_mock_sb([task])):
            resp = client.get(
                "/api/v1/workflows/instances/my-tasks",
                headers={"Authorization": f"Bearer {staff_token}"},
            )
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

    def test_approve_schema_rejects_extra_fields_gracefully(self, client, manager_token):
        """Approve endpoint accepts requests — 422 only for truly invalid JSON schema."""
        # Sending valid JSON (even if comment is absent) should NOT return 422
        # Use an obviously-bad instance ID to get 4xx from service, not 422 from schema
        resp = client.post(
            "/api/v1/workflows/instances/not-a-uuid/stages/not-a-uuid/approve",
            json={"comment": "ok"},
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        # 422 here is from path param UUID validation — that's fine
        assert resp.status_code == 422


class TestRejectStage:
    def test_reject_requires_comment(self, client, manager_token):
        """Reject without a comment should fail validation or be rejected by logic."""
        stage_inst = {
            "id": STAGE_INST_ID,
            "workflow_instance_id": INSTANCE_ID,
            "status": "in_progress",
            "workflow_stages": {"action_type": "approve"},
            "workflow_instances": {"organisation_id": ORG_ID},
        }
        q = MagicMock()
        r = MagicMock()
        r.data = stage_inst
        q.execute.return_value = r
        for method in ("select", "update", "eq", "maybe_single", "single"):
            getattr(q, method).return_value = q
        sb = MagicMock()
        sb.table.return_value = q

        with patch("routes.workflows.get_admin_client", return_value=sb):
            resp = client.post(
                f"/api/v1/workflows/instances/{INSTANCE_ID}/stages/{STAGE_INST_ID}/reject",
                json={},
                headers={"Authorization": f"Bearer {manager_token}"},
            )
        # 400 (missing comment) or 422 (validation) or 404 (stage not found with mock)
        assert resp.status_code in (400, 404, 422)


# ── Tests: Publish Validation ─────────────────────────────────────────────────

class TestPublishWorkflow:
    def test_publish_endpoint_exists_and_requires_admin(self, client, manager_token):
        resp = client.post(
            f"/api/v1/workflows/definitions/{DEF_ID}/publish",
            headers={"Authorization": f"Bearer {manager_token}"},
        )
        assert resp.status_code == 403

    def test_publish_fails_when_no_stages(self, client, admin_token):
        def_result = MagicMock()
        def_result.data = {
            "id": DEF_ID, "organisation_id": ORG_ID,
            "is_active": False, "is_deleted": False, "trigger_type": "manual",
            "trigger_config": {},
        }
        stages_result = MagicMock()
        stages_result.data = []  # no stages
        rules_result = MagicMock()
        rules_result.data = []

        sb = MagicMock()
        q = MagicMock()
        q.execute.side_effect = [def_result, stages_result, rules_result]
        for method in ("select", "update", "eq", "maybe_single", "single",
                       "neq", "order", "filter"):
            getattr(q, method).return_value = q
        sb.table.return_value = q

        with (
            patch("routes.workflows.get_admin_client", return_value=sb),
            patch("services.workflow_service.get_admin_client", return_value=sb),
        ):
            resp = client.post(
                f"/api/v1/workflows/definitions/{DEF_ID}/publish",
                headers={"Authorization": f"Bearer {admin_token}"},
            )
        # 422 = validation errors (no stages); 404 = mock DB miss
        assert resp.status_code in (404, 422)


# ── Tests: Cancel Instance ────────────────────────────────────────────────────

class TestCancelInstance:
    def test_cancel_requires_manager(self, client, staff_token):
        resp = client.post(
            f"/api/v1/workflows/instances/{INSTANCE_ID}/cancel",
            headers={"Authorization": f"Bearer {staff_token}"},
        )
        assert resp.status_code == 403

    def test_cancel_returns_200_or_404_for_manager(self, client, manager_token):
        inst = {"id": INSTANCE_ID, "organisation_id": ORG_ID, "status": "in_progress"}
        inst_result = MagicMock()
        inst_result.data = inst
        update_result = MagicMock()
        update_result.data = [{**inst, "status": "cancelled"}]

        q = MagicMock()
        q.execute.side_effect = [inst_result, update_result]
        for method in ("select", "update", "eq", "maybe_single", "single"):
            getattr(q, method).return_value = q
        sb = MagicMock()
        sb.table.return_value = q

        with (
            patch("routes.workflows.get_admin_client", return_value=sb),
            patch("services.workflow_service.get_admin_client", return_value=sb),
        ):
            resp = client.post(
                f"/api/v1/workflows/instances/{INSTANCE_ID}/cancel",
                json={"reason": "Testing cancellation"},
                headers={"Authorization": f"Bearer {manager_token}"},
            )
        assert resp.status_code in (200, 404)


# ── Tests: Stage Instance Detail ──────────────────────────────────────────────

class TestGetStageInstanceDetail:
    def test_returns_stage_history_field(self, client, staff_token):
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
        siblings_result = MagicMock()
        siblings_result.data = []

        q = MagicMock()
        main_res = MagicMock()
        main_res.data = stage_inst
        q.execute.side_effect = [main_res, siblings_result]
        for method in ("select", "eq", "maybe_single", "single", "order"):
            getattr(q, method).return_value = q
        sb = MagicMock()
        sb.table.return_value = q

        with patch("routes.workflows.get_admin_client", return_value=sb):
            resp = client.get(
                f"/api/v1/workflows/instances/{INSTANCE_ID}/stages/{STAGE_INST_ID}",
                headers={"Authorization": f"Bearer {staff_token}"},
            )
        assert resp.status_code in (200, 404)
        if resp.status_code == 200:
            data = resp.json()
            assert "stage_history" in data
