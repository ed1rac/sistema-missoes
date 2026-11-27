"""
Testes de saneamento do banco de produção, usuários padrão e persistência entre reinícios.
"""

import os
import sqlite3
import tempfile
from starlette.testclient import TestClient

import app.config as config
import app.database as database
from app.seed import seed_database
from app.auth import hash_password, verify_password
from app.main import app


def test_production_seed_has_no_mock_data_and_has_default_users():
    """Garante que seed_database() inicializa apenas usuários padrão e tabelas de domínio, sem dados mockados."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    fresh_db = tmp.name
    tmp.close()

    try:
        seed_database(fresh_db)
        conn = sqlite3.connect(fresh_db)
        conn.row_factory = sqlite3.Row

        # Tabelas operacionais devem iniciar completamente vazias
        assert conn.execute("SELECT COUNT(*) FROM servidores").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM missoes").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM missoes_participantes").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM audit_logs").fetchone()[0] == 0

        # Usuários padrão devem existir com seus respectivos perfis e senha inicial 123456
        users = {
            r["username"]: dict(r)
            for r in conn.execute("SELECT username, password_hash, role, ativo FROM usuarios").fetchall()
        }
        assert set(users.keys()) == {"admin", "edkallenn", "cadastrador", "gerencial"}
        assert users["edkallenn"]["role"] == "ADMIN"
        assert users["admin"]["role"] == "ADMIN"
        assert users["cadastrador"]["role"] == "CADASTRADOR"
        assert users["gerencial"]["role"] == "GERENCIAL"
        for uname, udata in users.items():
            assert udata["ativo"] == 1
            assert verify_password("123456", udata["password_hash"]), f"Senha padrão falhou para {uname}"

        # Tabelas de referência institucional devem estar populadas
        assert conn.execute("SELECT COUNT(*) FROM configuracoes").fetchone()[0] >= 6
        assert conn.execute("SELECT COUNT(*) FROM valores_diarias").fetchone()[0] == 3
        assert conn.execute("SELECT COUNT(*) FROM setores_destino").fetchone()[0] >= 52
        assert conn.execute("SELECT COUNT(*) FROM orgao_unidades").fetchone()[0] >= 14
        assert conn.execute("SELECT COUNT(*) FROM cargos").fetchone()[0] == 6
        assert conn.execute("SELECT COUNT(*) FROM tipos_missao").fetchone()[0] == 6
        assert conn.execute("SELECT COUNT(*) FROM papeis_missao").fetchone()[0] == 7
        conn.close()
    finally:
        if os.path.exists(fresh_db):
            os.remove(fresh_db)


def test_seed_database_preserves_changed_passwords_and_configs_on_restart():
    """Simula reinício do container Docker e garante que senhas e parâmetros alterados não são sobrescritos."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    fresh_db = tmp.name
    tmp.close()

    try:
        seed_database(fresh_db)

        conn = sqlite3.connect(fresh_db)
        new_hash = hash_password("NovaSenhaForte@2026!")
        conn.execute("UPDATE usuarios SET password_hash = ? WHERE username = 'edkallenn'", (new_hash,))
        conn.execute("UPDATE configuracoes SET valor = '490.00' WHERE chave = 'valor_diaria_padrao'")
        conn.execute("UPDATE valores_diarias SET valor = 350.00 WHERE categoria = 'INTERIOR'")
        conn.execute("UPDATE orgao_unidades SET valor_diaria = 350.00 WHERE sigla = 'DPF/CGE/PB'")
        conn.commit()
        conn.close()

        # Simula novo boot da aplicação (lifespan -> seed_database)
        seed_database(fresh_db)

        conn2 = sqlite3.connect(fresh_db)
        conn2.row_factory = sqlite3.Row
        edk_hash = conn2.execute("SELECT password_hash FROM usuarios WHERE username = 'edkallenn'").fetchone()["password_hash"]
        assert verify_password("NovaSenhaForte@2026!", edk_hash)
        assert not verify_password("123456", edk_hash)

        cfg_val = conn2.execute("SELECT valor FROM configuracoes WHERE chave = 'valor_diaria_padrao'").fetchone()["valor"]
        assert cfg_val == "490.00"

        vd_int = conn2.execute("SELECT valor FROM valores_diarias WHERE categoria = 'INTERIOR'").fetchone()["valor"]
        assert vd_int == 350.00

        unid_cge = conn2.execute("SELECT valor_diaria FROM orgao_unidades WHERE sigla = 'DPF/CGE/PB'").fetchone()["valor_diaria"]
        assert unid_cge == 350.00
        conn2.close()
    finally:
        if os.path.exists(fresh_db):
            os.remove(fresh_db)


def test_api_operates_cleanly_on_sanitized_empty_database():
    """Valida que todos os endpoints principais funcionam com banco vazio de servidores e missões."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    empty_db = tmp.name
    tmp.close()

    prev_db_file = config.DB_FILE
    prev_db_mod_file = database.DB_FILE
    prev_db_url = config.DATABASE_URL
    try:
        seed_database(empty_db)
        config.DB_FILE = empty_db
        database.DB_FILE = empty_db
        config.DATABASE_URL = f"sqlite:///{empty_db}"

        with TestClient(app) as c:
            res_health = c.get("/api/health")
            assert res_health.status_code == 200
            assert res_health.json()["port"] == 5179

            res_login = c.post("/api/auth/login", json={"username": "edkallenn", "password": "123456"})
            assert res_login.status_code == 200
            headers = {"Authorization": f"Bearer {res_login.json()['access_token']}"}

            res_srv = c.get("/api/servidores", headers=headers)
            assert res_srv.status_code == 200
            assert res_srv.json() == []

            res_mis = c.get("/api/missoes", headers=headers)
            assert res_mis.status_code == 200
            assert res_mis.json() == []

            res_sum = c.get("/api/dashboard/summary", headers=headers)
            assert res_sum.status_code == 200
            summary = res_sum.json()
            assert summary["total_missoes"] == 0
            assert summary["total_servidores_ativos"] == 0
            assert summary["custo_total_geral"] == 0.0

            res_charts = c.get("/api/dashboard/charts", headers=headers)
            assert res_charts.status_code == 200

            assert c.get("/api/export/missoes.csv", headers=headers).status_code == 200
            assert c.get("/api/export/missoes.xlsx", headers=headers).status_code == 200
            res_json = c.get("/api/export/missoes.json", headers=headers)
            assert res_json.status_code == 200
            assert res_json.json()["total_registros"] == 0
    finally:
        config.DB_FILE = prev_db_file
        database.DB_FILE = prev_db_mod_file
        config.DATABASE_URL = prev_db_url
        if os.path.exists(empty_db):
            os.remove(empty_db)
