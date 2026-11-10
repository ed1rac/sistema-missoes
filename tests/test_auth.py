def test_login_admin_success(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "123456"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["user"]["username"] == "admin"
    assert data["user"]["role"] == "ADMIN"

def test_login_edkallenn_success(client):
    res = client.post("/api/auth/login", json={"username": "edkallenn", "password": "123456"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["user"]["username"] == "edkallenn"
    assert data["user"]["role"] == "ADMIN"

def test_login_invalid_password(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "wrongpassword"})
    assert res.status_code == 401

def test_get_me_with_token(client, edkallenn_headers):
    res = client.get("/api/auth/me", headers=edkallenn_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["username"] == "edkallenn"
    assert data["role"] == "ADMIN"

def test_protected_route_without_token(client):
    res = client.get("/api/missoes")
    assert res.status_code == 401
