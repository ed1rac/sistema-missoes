import os
import sys
import tempfile
from pathlib import Path
import pytest
from starlette.testclient import TestClient

# Adicionar pasta raiz ao sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Configurar banco de dados de teste temporário
test_db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
test_db_path = test_db_file.name
test_db_file.close()

import app.config as config
config.DB_FILE = test_db_path
config.DATABASE_URL = f"sqlite:///{test_db_path}"

from app.seed import seed_database
from app.main import app

@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    seed_database(test_db_path)
    yield
    # Limpeza após testes
    try:
        if os.path.exists(test_db_path):
            os.remove(test_db_path)
    except Exception:
        pass

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture
def admin_token(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "123456"})
    assert res.status_code == 200
    return res.json()["access_token"]

@pytest.fixture
def edkallenn_token(client):
    res = client.post("/api/auth/login", json={"username": "edkallenn", "password": "123456"})
    assert res.status_code == 200
    return res.json()["access_token"]

@pytest.fixture
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}

@pytest.fixture
def edkallenn_headers(edkallenn_token):
    return {"Authorization": f"Bearer {edkallenn_token}"}
