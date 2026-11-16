import sqlite3
import tempfile
import os
from app.database import init_db


def test_servidor_cpf_login_vazio_email_opcional_e_duplicidade(client, admin_headers):
    """
    Valida:
    - Novo campo CPF no CRUD e na busca
    - login_rede vazio convertido para NULL (permite múltiplos servidores sem login)
    - email_institucional opcional com fallback automático
    - Duplicidade de login_rede retorna HTTP 400 (não 500 IntegrityError)
    """
    res1 = client.post(
        "/api/servidores",
        json={
            "matricula": "88001",
            "nome_completo": "JOAO PEDRO TESTE CPF",
            "cpf": "123.456.789-00",
            "cargo_sigla": "APF",
            "unidade_sigla": "SR/PF/PB",
            "login_rede": "",
            "telefone_celular": "(83) 99999-1111"
        },
        headers=admin_headers
    )
    assert res1.status_code == 201, res1.text
    s1 = res1.json()
    assert s1["cpf"] == "123.456.789-00"
    assert s1["login_rede"] is None
    assert s1["email_institucional"]

    # Segundo servidor também com login_rede="" e sem e-mail não deve colidir
    res2 = client.post(
        "/api/servidores",
        json={
            "matricula": "88002",
            "nome_completo": "MARIA CLARA TESTE LOGIN VAZIO",
            "cpf": "987.654.321-11",
            "cargo_sigla": "EPF",
            "unidade_sigla": "DPF/CGE/PB",
            "login_rede": "   "
        },
        headers=admin_headers
    )
    assert res2.status_code == 201, res2.text
    assert res2.json()["login_rede"] is None

    # Busca por CPF
    res_q = client.get("/api/servidores?q=123.456.789", headers=admin_headers)
    assert res_q.status_code == 200
    assert any(s["matricula"] == "88001" for s in res_q.json())

    # Atualizar servidor 88001 com login_rede único e depois tentar duplicar no 88002 -> HTTP 400
    res_up1 = client.put("/api/servidores/88001", json={"login_rede": "joao.teste.uniq"}, headers=admin_headers)
    assert res_up1.status_code == 200
    assert res_up1.json()["login_rede"] == "joao.teste.uniq"

    res_dup = client.put("/api/servidores/88002", json={"login_rede": "joao.teste.uniq"}, headers=admin_headers)
    assert res_dup.status_code == 400


def test_migration_idempotente_adiciona_cpf_em_banco_existente():
    """Garante que init_db adiciona a coluna cpf sem perda de dados em DB pré-existente."""
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp_path = tmp.name
    tmp.close()
    try:
        conn = sqlite3.connect(tmp_path)
        conn.execute("""
            CREATE TABLE servidores (
                id TEXT PRIMARY KEY,
                matricula TEXT UNIQUE NOT NULL,
                nome_completo TEXT NOT NULL,
                nome_guerra TEXT,
                cargo_sigla TEXT NOT NULL,
                unidade_sigla TEXT NOT NULL,
                login_rede TEXT UNIQUE,
                email_institucional TEXT UNIQUE NOT NULL,
                telefone_celular TEXT,
                tpe INTEGER NOT NULL DEFAULT 0,
                is_missionario_geral INTEGER NOT NULL DEFAULT 1,
                observacoes_gerais TEXT,
                ativo INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            INSERT INTO servidores (id, matricula, nome_completo, cargo_sigla, unidade_sigla, email_institucional)
            VALUES ('srv-leg', '77777', 'SERVIDOR LEGADO', 'APF', 'SR/PF/PB', 'legado@pf.gov.br')
        """)
        conn.commit()
        conn.close()

        init_db(tmp_path)

        conn2 = sqlite3.connect(tmp_path)
        cols = [r[1] for r in conn2.execute("PRAGMA table_info(servidores)").fetchall()]
        row = conn2.execute("SELECT nome_completo FROM servidores WHERE matricula='77777'").fetchone()
        conn2.close()
        assert "cpf" in cols
        assert row[0] == "SERVIDOR LEGADO"
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def test_criacao_simplificada_individual_e_diaria_explicita(client, admin_headers):
    """
    Valida:
    - Defaults automáticos quando titulo, tipo_missao, unidade_solicitante e localidade_descricao são omitidos
    - meio_transporte = NAO_DEFINIDO zera passagens
    - valor_diaria_padrao enviado explicitamente (mesmo 425.00) é respeitado mesmo com unidade_destino=DPF/CGE/PB
    """
    res = client.post(
        "/api/missoes",
        json={
            "modalidade": "INDIVIDUAL",
            "missionario_matricula": "38104",
            "unidade_destino": "DPF/CGE/PB",
            "data_inicio": "2027-03-01",
            "data_termino": "2027-03-03",
            "meio_transporte": "NAO_DEFINIDO",
            "custo_estimado_passagens": 999.00,
            "valor_diaria_padrao": 425.00,
            "numero_pcdp": "PCDP-2027-001",
            "numero_sat": "SAT-2027-001",
            "observacoes": "Nota pontual de viagem do recrutamento",
            "status_atual": "Indicado"
        },
        headers=admin_headers
    )
    assert res.status_code == 201, res.text
    m = res.json()
    assert m["titulo"]
    assert m["tipo_missao"]
    assert m["unidade_solicitante"] == "SR/PF/PB"
    assert m["localidade_descricao"] == "Campina Grande/PB"
    assert m["meio_transporte"] == "NAO_DEFINIDO"
    assert m["custo_estimado_passagens"] == 0.0
    assert m["valor_diaria_padrao"] == 425.00
    assert m["numero_pcdp"] == "PCDP-2027-001"
    assert m["numero_sat"] == "SAT-2027-001"
    assert m["observacoes"] == "Nota pontual de viagem do recrutamento"
    # 3 dias = 2.5 diárias * 425.00 = 1062.50
    assert m["total_custo_diarias"] == 1062.50
    assert m["total_custo_passagens"] == 0.0
    assert m["total_custo_geral"] == 1062.50


def test_put_missao_sincroniza_passagens_e_zera_nao_aereo(client, admin_headers):
    """
    Valida que PUT /api/missoes/{id}:
    - Preserva e atualiza valor_passagem_aerea e custo_total_servidor em AEREO
    - Zera custo_estimado_passagens e valor_passagem_aerea ao mudar para TERRESTRE / PROPRIO / NAO_DEFINIDO
    """
    res_c = client.post(
        "/api/missoes",
        json={
            "modalidade": "INDIVIDUAL",
            "missionario_matricula": "41205",
            "unidade_destino": "SR/PF/DF",
            "data_inicio": "2027-04-01",
            "data_termino": "2027-04-04",
            "meio_transporte": "AEREO",
            "custo_estimado_passagens": 1200.00,
            "valor_diaria_padrao": 425.00
        },
        headers=admin_headers
    )
    assert res_c.status_code == 201, res_c.text
    mid = res_c.json()["id"]
    assert res_c.json()["total_custo_passagens"] == 1200.00
    assert res_c.json()["total_custo_geral"] == (3.5 * 425.00) + 1200.00

    # Editar datas e valor de passagens em AEREO (passagem NÃO deve zerar!)
    res_up_aereo = client.put(
        f"/api/missoes/{mid}",
        json={
            "data_inicio": "2027-04-01",
            "data_termino": "2027-04-05",
            "meio_transporte": "AEREO",
            "custo_estimado_passagens": 1450.00
        },
        headers=admin_headers
    )
    assert res_up_aereo.status_code == 200, res_up_aereo.text
    m_aereo = res_up_aereo.json()
    assert m_aereo["total_custo_passagens"] == 1450.00
    assert m_aereo["total_custo_diarias"] == 4.5 * 425.00
    assert m_aereo["total_custo_geral"] == (4.5 * 425.00) + 1450.00
    assert m_aereo["participantes"][0]["valor_passagem_aerea"] == 1450.00

    # Alterar para TERRESTRE -> deve zerar passagens em missoes e missoes_participantes
    res_up_terr = client.put(
        f"/api/missoes/{mid}",
        json={
            "meio_transporte": "TERRESTRE",
            "custo_estimado_passagens": 1450.00
        },
        headers=admin_headers
    )
    assert res_up_terr.status_code == 200, res_up_terr.text
    m_terr = res_up_terr.json()
    assert m_terr["meio_transporte"] == "TERRESTRE"
    assert m_terr["custo_estimado_passagens"] == 0.0
    assert m_terr["total_custo_passagens"] == 0.0
    assert m_terr["participantes"][0]["meio_transporte"] == "TERRESTRE"
    assert m_terr["participantes"][0]["valor_passagem_aerea"] == 0.0
    assert m_terr["total_custo_geral"] == 4.5 * 425.00


def test_rbac_cadastrador_bloqueado_em_post_e_put_status_avancado(client, cadastrador_headers, admin_headers):
    """Impede bypass de RBAC do perfil CADASTRADOR via POST e PUT."""
    # POST já tentando criar com OM EMITIDA -> 403
    res_post_forb = client.post(
        "/api/missoes",
        json={
            "modalidade": "INDIVIDUAL",
            "missionario_matricula": "38104",
            "unidade_destino": "SR/PF/DF",
            "data_inicio": "2027-05-01",
            "data_termino": "2027-05-03",
            "status_atual": "OM EMITIDA"
        },
        headers=cadastrador_headers
    )
    assert res_post_forb.status_code == 403

    # POST válido com status inicial Indicado -> 201
    res_post_ok = client.post(
        "/api/missoes",
        json={
            "modalidade": "INDIVIDUAL",
            "missionario_matricula": "38104",
            "unidade_destino": "SR/PF/DF",
            "data_inicio": "2027-05-01",
            "data_termino": "2027-05-03",
            "status_atual": "Indicado"
        },
        headers=cadastrador_headers
    )
    assert res_post_ok.status_code == 201
    mid = res_post_ok.json()["id"]

    # PUT tentando promover status para PCDP CADASTRADA -> 403
    res_put_forb = client.put(
        f"/api/missoes/{mid}",
        json={"status_atual": "PCDP CADASTRADA"},
        headers=cadastrador_headers
    )
    assert res_put_forb.status_code == 403

    # Admin consegue promover para PCDP ENCAMINHADA
    res_admin_ok = client.put(
        f"/api/missoes/{mid}",
        json={"status_atual": "PCDP ENCAMINHADA"},
        headers=admin_headers
    )
    assert res_admin_ok.status_code == 200
    assert res_admin_ok.json()["status_atual"] == "PCDP ENCAMINHADA"

    # PCDP ENCAMINHADA aparece no contador SCDP do dashboard
    res_dash = client.get("/api/dashboard/summary?ano=2027", headers=admin_headers)
    assert res_dash.status_code == 200
    assert res_dash.json()["servidores_cadastrar_scdp"] >= 1


def test_isencao_sede_automatica(client, admin_headers):
    """Servidor lotado na mesma unidade de destino recebe isenção automática (0 diárias)."""
    # 33412 é lotado em SR/PF/PB; missão para SR/PF/PB -> is_missao_sede=True -> 0 diárias
    res = client.post(
        "/api/missoes",
        json={
            "modalidade": "INDIVIDUAL",
            "missionario_matricula": "33412",
            "unidade_destino": "SR/PF/PB",
            "data_inicio": "2027-06-01",
            "data_termino": "2027-06-04",
            "meio_transporte": "TERRESTRE"
        },
        headers=admin_headers
    )
    assert res.status_code == 201, res.text
    m = res.json()
    assert m["total_custo_diarias"] == 0.0
    assert m["participantes"][0]["is_missao_sede"] is True
    assert m["participantes"][0]["qtd_diarias"] == 0.0


def test_ui_assets_apontamentos_pdf_presentes(client):
    """Verifica HTML e JS servidos refletindo nome oficial, remoção da badge e novos fluxos."""
    res_html = client.get("/")
    assert res_html.status_code == 200
    html = res_html.text
    assert "Sistema de Controle de Diárias e Passagens" in html
    assert "Gestão Recrutamento" in html
    assert "header-diaria-val" not in html

    res_js = client.get("/static/app.js")
    assert res_js.status_code == 200
    js = res_js.text
    assert "GESTÃO RECRUTAMENTO" in js
    assert "NOVO RECRUTAMENTO" in js
    assert "SERVIDOR RECRUTADO" in js
    assert "STATUS_CHANGE" in js
    assert "UPDATE_VALOR_DIARIA" in js
    assert "downloadExport" in js
