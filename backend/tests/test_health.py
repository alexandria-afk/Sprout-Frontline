def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "environment" in body


def test_health_has_request_id_header(client):
    response = client.get("/health")
    assert "x-request-id" in response.headers
