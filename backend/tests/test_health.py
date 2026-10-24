from fastapi.testclient import TestClient


def test_health_reports_ok_and_model(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "model": "fake"}
