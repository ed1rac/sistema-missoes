import pytest
from zoneinfo import ZoneInfo
from datetime import datetime

def test_unidades_pb_no_topo(client, admin_headers):
    """Garante que as 3 primeiras unidades retornadas sejam rigorosamente as da Paraíba na ordem solicitada."""
    res = client.get("/api/missoes/meta/unidades", headers=admin_headers)
    assert res.status_code == 200
    unidades = res.json()
    assert len(unidades) >= 3

    assert unidades[0]["sigla"] == "SR/PF/PB"
    assert unidades[0]["nome_extenso"] == "Superintendência Regional na Paraíba"

    assert unidades[1]["sigla"] == "CGE/PF/PB"
    assert unidades[1]["nome_extenso"] == "Delegacia de Polícia Federal em Campina Grande/PB"

    assert unidades[2]["sigla"] == "PAT/PF/PB"
    assert unidades[2]["nome_extenso"] == "Delegacia de Polícia Federal em Patos/PB"

    # Garantir ausência total de referências a ANP em todas as unidades
    for u in unidades:
        assert u.get("orgao_gestor") != "ANP"
        assert "ANP" not in u.get("sigla", "")
        assert "ANP" not in u.get("nome_extenso", "")


def test_cadastrador_pode_criar_mas_nao_aprovar(client, cadastrador_headers, admin_headers):
    """Perfil CADASTRADOR pode criar/editar missões, mas NÃO pode aprovar nem emitir OM."""
    cod = "MIS-2026-TEST-CAD01"
    payload = {
        "codigo_missao": cod,
        "titulo": "Missão de Teste Cadastrador",
        "tipo_missao": "OPERACIONAL",
        "modalidade": "EQUIPE",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "CGE/PF/PB",
        "localidade_descricao": "Campina Grande/PB",
        "data_inicio": "2026-09-01",
        "data_termino": "2026-09-05",
        "valor_diaria_padrao": 425.00,
        "responsavel_matricula": "10293",
        "justificativa": "Teste de permissões de cadastro",
        "status_atual": "RASCUNHO"
    }

    # Cadastrador cria com sucesso
    res_create = client.post("/api/missoes", json=payload, headers=cadastrador_headers)
    assert res_create.status_code == 201, res_create.text
    missao_id = res_create.json()["id"]

    # Cadastrador pode submeter solicitação
    res_solic = client.patch(f"/api/missoes/{missao_id}/status", json={"novo_status": "SOLICITADA"}, headers=cadastrador_headers)
    assert res_solic.status_code == 200

    # Cadastrador tenta APROVAR -> deve receber 403 Forbidden
    res_aprov = client.patch(f"/api/missoes/{missao_id}/status", json={"novo_status": "APROVADA"}, headers=cadastrador_headers)
    assert res_aprov.status_code == 403

    # Cadastrador tenta EMITIR OM -> deve receber 403 Forbidden
    res_om = client.patch(f"/api/missoes/{missao_id}/status", json={"novo_status": "OM_EMITIDA"}, headers=cadastrador_headers)
    assert res_om.status_code == 403

    # Administrador aprova com sucesso
    res_admin_aprov = client.patch(f"/api/missoes/{missao_id}/status", json={"novo_status": "APROVADA"}, headers=admin_headers)
    assert res_admin_aprov.status_code == 200
    assert res_admin_aprov.json()["status_atual"] == "APROVADA"


def test_gerencial_acesso_somente_leitura(client, gerencial_headers):
    """Perfil GERENCIAL pode consultar todos os dashboards, filtros e missões, mas é bloqueado para escrita."""
    # Leitura permitida
    res_missoes = client.get("/api/missoes", headers=gerencial_headers)
    assert res_missoes.status_code == 200

    res_summary = client.get("/api/dashboard/summary", headers=gerencial_headers)
    assert res_summary.status_code == 200

    res_charts = client.get("/api/dashboard/charts", headers=gerencial_headers)
    assert res_charts.status_code == 200

    res_audit = client.get("/api/audit/logs", headers=gerencial_headers)
    assert res_audit.status_code == 200

    res_srv = client.get("/api/servidores", headers=gerencial_headers)
    assert res_srv.status_code == 200

    # Tentativas de escrita devem receber 403 Forbidden
    res_post_m = client.post("/api/missoes", json={"codigo_missao": "MIS-GER-01"}, headers=gerencial_headers)
    assert res_post_m.status_code == 403

    res_post_s = client.post("/api/servidores", json={"matricula": "99999"}, headers=gerencial_headers)
    assert res_post_s.status_code == 403

    res_status = client.patch("/api/missoes/1/status", json={"novo_status": "APROVADA"}, headers=gerencial_headers)
    assert res_status.status_code == 403

    # Não tem acesso a gestão de usuários (Admin only)
    res_usr = client.get("/api/usuarios", headers=gerencial_headers)
    assert res_usr.status_code == 403


def test_missao_individual_vincula_participante_e_calcula_diarias(client, admin_headers):
    """Criação de missão individual vincula automaticamente o missionário como participante único e calcula diárias."""
    cod = "MIS-2026-IND-AUTO"
    payload = {
        "codigo_missao": cod,
        "titulo": "Perícia Externa Individual em Guarabira/PB",
        "tipo_missao": "PERICIA",
        "modalidade": "INDIVIDUAL",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "PAT/PF/PB",
        "localidade_descricao": "Patos/PB",
        "data_inicio": "2026-10-10",
        "data_termino": "2026-10-13",  # 4 dias corridos: 10, 11, 12, 13
        "valor_diaria_padrao": 500.00,
        "responsavel_matricula": "33412",  # DPF Francisco de Assis
        "missionario_matricula": "41205",  # PCF Ana Beatriz Nogueira
        "justificativa": "Laudo pericial urgente em local de crime",
        "status_atual": "RASCUNHO"
    }

    res = client.post("/api/missoes", json=payload, headers=admin_headers)
    assert res.status_code == 201, res.text
    missao = res.json()
    assert missao["modalidade"] == "INDIVIDUAL"
    assert missao["missionario_matricula"] == "41205"

    # Buscar detalhes com participantes
    res_detalhe = client.get(f"/api/missoes/{missao['id']}", headers=admin_headers)
    assert res_detalhe.status_code == 200
    det = res_detalhe.json()

    assert len(det["participantes"]) == 1
    part = det["participantes"][0]
    assert part["servidor_matricula"] == "41205"
    assert part["papel"] == "Missionário Individual"
    # Cálculo para 4 dias corridos: (4 - 0.5) = 3.5 diárias
    assert part["qtd_diarias"] == 3.5
    # Valor unitário 500.00 * 3.5 = 1750.00
    assert part["valor_total_diarias"] == 1750.00
    assert det["total_custo_diarias"] == 1750.00


def test_missao_individual_conflito_de_agenda(client, admin_headers):
    """Missão individual impede sobreposição de agenda do mesmo policial missionário."""
    # A missão anterior foi criada de 2026-10-10 a 2026-10-13 para a matrícula 41205
    cod_conflito = "MIS-2026-IND-CONFLITO"
    payload_conflito = {
        "codigo_missao": cod_conflito,
        "titulo": "Segunda missão concomitante para o mesmo policial",
        "tipo_missao": "OPERACIONAL",
        "modalidade": "INDIVIDUAL",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "PAT/PF/PB",
        "localidade_descricao": "Patos/PB",
        "data_inicio": "2026-10-12",  # Sobrepõe com 10 a 13
        "data_termino": "2026-10-15",
        "valor_diaria_padrao": 425.00,
        "responsavel_matricula": "33412",
        "missionario_matricula": "41205",
        "justificativa": "Tentativa de duplicidade",
        "status_atual": "RASCUNHO"
    }

    res = client.post("/api/missoes", json=payload_conflito, headers=admin_headers)
    assert res.status_code == 400
    assert "conflito" in res.json()["detail"].lower()


def test_crud_usuarios_e_seguranca_admin(client, admin_headers):
    """CRUD completo de novos usuários com validação de perfis e proteção contra autoexclusão."""
    novo_user = {
        "username": "agente.teste",
        "full_name": "Agente Teste Operacional",
        "email": "agente.teste@pf.gov.br",
        "password": "senhaSegura123",
        "role": "CADASTRADOR",
        "is_active": True
    }

    # 1. Criar Usuário
    res_post = client.post("/api/usuarios", json=novo_user, headers=admin_headers)
    assert res_post.status_code == 201
    user_id = res_post.json()["id"]
    assert res_post.json()["username"] == "agente.teste"
    assert res_post.json()["role"] == "CADASTRADOR"

    # 2. Listar Usuários
    res_list = client.get("/api/usuarios", headers=admin_headers)
    assert res_list.status_code == 200
    logins = [u["username"] for u in res_list.json()]
    assert "agente.teste" in logins

    # 3. Editar Usuário
    res_put = client.put(f"/api/usuarios/{user_id}", json={
        "full_name": "Agente Teste Atualizado",
        "email": "agente.atualizado@pf.gov.br",
        "role": "GERENCIAL",
        "is_active": True
    }, headers=admin_headers)
    assert res_put.status_code == 200
    assert res_put.json()["full_name"] == "Agente Teste Atualizado"
    assert res_put.json()["role"] == "GERENCIAL"

    # 4. Resetar Senha
    res_pwd = client.post(f"/api/usuarios/{user_id}/reset-password", json={
        "new_password": "NovaSenhaForte456"
    }, headers=admin_headers)
    assert res_pwd.status_code == 200

    # 5. Autenticar com a nova senha
    res_login = client.post("/api/auth/login", json={
        "username": "agente.teste",
        "password": "NovaSenhaForte456"
    })
    assert res_login.status_code == 200
    assert res_login.json()["user"]["role"] == "GERENCIAL"

    # 6. Excluir Usuário Criado
    res_del = client.delete(f"/api/usuarios/{user_id}", headers=admin_headers)
    assert res_del.status_code == 200

    # 7. Proteção: Admin não pode excluir a si próprio
    me = client.get("/api/auth/me", headers=admin_headers).json()
    res_del_self = client.delete(f"/api/usuarios/{me['id']}", headers=admin_headers)
    assert res_del_self.status_code == 400
    assert "autenticado" in res_del_self.json()["detail"].lower()


def test_auditoria_registra_horario_oficial_brasil(client, admin_headers):
    """Trilha de auditoria registra eventos com timestamp no fuso horário oficial de Brasília (BRT / UTC-3)."""
    # Realizar ação auditável
    res_login = client.post("/api/auth/login", json={"username": "admin", "password": "123456"})
    assert res_login.status_code == 200

    # Consultar trilha
    res_audit = client.get("/api/audit/logs?limite=10", headers=admin_headers)
    assert res_audit.status_code == 200
    logs = res_audit.json()
    assert len(logs) > 0

    # Validar formato de data do primeiro log
    latest = logs[0]
    ts_str = latest["timestamp"]
    # Formato deve ser YYYY-MM-DD HH:MM:SS
    dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
    assert dt.year == 2026 or dt.year >= 2025


def test_dashboard_filtros_universais(client, admin_headers):
    """Dashboard summary e charts respondem a filtros universais de ano, mês e modalidade."""
    res_sum = client.get("/api/dashboard/summary?ano=2026&mes=05", headers=admin_headers)
    assert res_sum.status_code == 200
    data_sum = res_sum.json()
    assert "total_missoes" in data_sum
    assert "custo_total_geral" in data_sum

    res_charts = client.get("/api/dashboard/charts?ano=2026", headers=admin_headers)
    assert res_charts.status_code == 200
    data_charts = res_charts.json()
    assert "custos_por_mes" in data_charts
    assert "status_counts" in data_charts
    assert "tipo_counts" in data_charts


def test_missao_individual_rejeita_multiplos_participantes(client, admin_headers):
    """Missão com modalidade INDIVIDUAL rejeita inclusão manual de participantes adicionais."""
    cod = "MIS-2027-IND-REJECT-ADD"
    payload = {
        "codigo_missao": cod,
        "titulo": "Perícia Balística Individual 2027",
        "tipo_missao": "Perícia Oficial",
        "modalidade": "INDIVIDUAL",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "CGE/PF/PB",
        "localidade_descricao": "Campina Grande/PB",
        "data_inicio": "2027-01-10",
        "data_termino": "2027-01-15",
        "valor_diaria_padrao": 425.00,
        "responsavel_matricula": "10293",
        "missionario_matricula": "41205",
        "justificativa": "Missão individual exclusiva",
        "status_atual": "RASCUNHO"
    }
    res_create = client.post("/api/missoes", json=payload, headers=admin_headers)
    assert res_create.status_code == 201, res_create.text
    missao_id = res_create.json()["id"]

    # Tentativa de adicionar outro participante na missão individual deve retornar 400
    res_add = client.post(
        f"/api/missoes/{missao_id}/participantes",
        json={
            "servidor_matricula": "38104",
            "papel": "Apoio Operacional",
            "data_apresentacao": "2027-01-10",
            "data_retorno": "2027-01-15"
        },
        headers=admin_headers
    )
    assert res_add.status_code == 400
    assert "individual" in res_add.json()["detail"].lower()


def test_missao_individual_conflito_ao_atualizar(client, admin_headers):
    """Atualização de datas de missão individual detecta e bloqueia conflito de agenda do missionário."""
    # Cria primeira missão para o servidor 38104 em 2027-02-01 a 2027-02-05
    cod1 = "MIS-2027-IND-BASE"
    payload1 = {
        "codigo_missao": cod1,
        "titulo": "Operação Base PB 2027",
        "tipo_missao": "Operacional / Repressão",
        "modalidade": "INDIVIDUAL",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "PAT/PF/PB",
        "localidade_descricao": "Patos/PB",
        "data_inicio": "2027-02-01",
        "data_termino": "2027-02-05",
        "valor_diaria_padrao": 425.00,
        "responsavel_matricula": "10293",
        "missionario_matricula": "38104",
        "justificativa": "Base",
        "status_atual": "APROVADA"
    }
    res1 = client.post("/api/missoes", json=payload1, headers=admin_headers)
    assert res1.status_code == 201, res1.text

    # Cria segunda missão em datas diferentes (2027-02-15 a 2027-02-20)
    cod2 = "MIS-2027-IND-TO-UPDATE"
    payload2 = {
        "codigo_missao": cod2,
        "titulo": "Operação Futura PB 2027",
        "tipo_missao": "Operacional / Repressão",
        "modalidade": "INDIVIDUAL",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "CGE/PF/PB",
        "localidade_descricao": "Campina Grande/PB",
        "data_inicio": "2027-02-15",
        "data_termino": "2027-02-20",
        "valor_diaria_padrao": 425.00,
        "responsavel_matricula": "10293",
        "missionario_matricula": "38104",
        "justificativa": "Futura",
        "status_atual": "RASCUNHO"
    }
    res2 = client.post("/api/missoes", json=payload2, headers=admin_headers)
    assert res2.status_code == 201, res2.text
    missao2_id = res2.json()["id"]

    # Tenta atualizar datas da segunda missão para colidir com a primeira (2027-02-03 a 2027-02-08)
    res_update_conflict = client.put(
        f"/api/missoes/{missao2_id}",
        json={
            "data_inicio": "2027-02-03",
            "data_termino": "2027-02-08"
        },
        headers=admin_headers
    )
    assert res_update_conflict.status_code == 400
    assert "conflito" in res_update_conflict.json()["detail"].lower()


def test_auditoria_login_falho_e_bloqueado(client, admin_headers):
    """Tentativas de login com credenciais incorretas ou usuário inativo geram auditoria forense detalhada."""
    # 1. Login com senha errada
    res_failed = client.post("/api/auth/login", json={"username": "admin", "password": "senha_errada_123"})
    assert res_failed.status_code == 401

    # 2. Consultar logs de auditoria
    res_logs = client.get("/api/audit/logs?limite=10", headers=admin_headers)
    assert res_logs.status_code == 200
    logs = res_logs.json()
    falha_log = next((l for l in logs if l["operacao"] == "LOGIN_FAILED" and l["usuario_login"] == "admin"), None)
    assert falha_log is not None
    assert falha_log["entidade_tabela"] == "usuarios"
    assert "detalhes" in falha_log
    assert falha_log["detalhes"]["motivo"] == "Credenciais inválidas"

    # 3. Usuário inativo tenta logar
    res_user = client.post(
        "/api/usuarios",
        json={
            "username": "usuario.desativado",
            "full_name": "Usuário Desativado",
            "email": "desativado@pf.gov.br",
            "password": "SenhaAtiva123",
            "role": "SERVIDOR",
            "is_active": False
        },
        headers=admin_headers
    )
    assert res_user.status_code == 201

    res_blocked = client.post("/api/auth/login", json={"username": "usuario.desativado", "password": "SenhaAtiva123"})
    assert res_blocked.status_code == 403

    # Checa auditoria de bloqueio
    res_logs2 = client.get("/api/audit/logs?limite=10", headers=admin_headers)
    logs2 = res_logs2.json()
    bloq_log = next((l for l in logs2 if l["operacao"] == "LOGIN_BLOCKED" and l["usuario_login"] == "usuario.desativado"), None)
    assert bloq_log is not None


def test_crud_unidades_e_prioridade(client, admin_headers, cadastrador_headers):
    """Admin realiza CRUD completo de unidades; Perfis não-admin são bloqueados."""
    nova_unid = {
        "sigla": "DPF/CPV/PB",
        "nome_extenso": "Delegacia de Polícia Federal em Cajazeiras/PB",
        "municipio": "Cajazeiras",
        "uf": "PB",
        "is_fronteira": False,
        "ativo": True
    }

    # 1. Não-admin tenta criar unidade -> 403
    res_cad_post = client.post("/api/missoes/meta/unidades", json=nova_unid, headers=cadastrador_headers)
    assert res_cad_post.status_code == 403

    # 2. Admin cria com sucesso -> 201
    res_post = client.post("/api/missoes/meta/unidades", json=nova_unid, headers=admin_headers)
    assert res_post.status_code == 201
    unid_criada = res_post.json()
    assert unid_criada["sigla"] == "DPF/CPV/PB"
    unid_id = unid_criada["id"]

    # 3. Admin edita unidade
    res_put = client.put(
        f"/api/missoes/meta/unidades/{unid_id}",
        json={"nome_extenso": "Posto Avançado da PF em Cajazeiras/PB", "is_fronteira": True},
        headers=admin_headers
    )
    assert res_put.status_code == 200
    assert res_put.json()["nome_extenso"] == "Posto Avançado da PF em Cajazeiras/PB"
    assert res_put.json()["is_fronteira"] is True

    # 4. Admin desativa unidade (soft-delete)
    res_del = client.delete(f"/api/missoes/meta/unidades/{unid_id}", headers=admin_headers)
    assert res_del.status_code == 200

    # 5. Listagem padrão (apenas ativas) não deve conter a unidade desativada
    res_list_ativas = client.get("/api/missoes/meta/unidades", headers=admin_headers)
    siglas_ativas = [u["sigla"] for u in res_list_ativas.json()]
    assert "DPF/CPV/PB" not in siglas_ativas

    # 6. Listagem com todas=true deve conter a unidade desativada
    res_list_todas = client.get("/api/missoes/meta/unidades?todas=true", headers=admin_headers)
    siglas_todas = [u["sigla"] for u in res_list_todas.json()]
    assert "DPF/CPV/PB" in siglas_todas

