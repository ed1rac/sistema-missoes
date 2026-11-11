import pytest
from datetime import date, timedelta

def test_meta_valores_diarias(client, edkallenn_headers):
    """Verifica se a tabela com as 3 faixas de diária oficiais está disponível."""
    res = client.get("/api/missoes/meta/valores-diarias", headers=edkallenn_headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 3

    valores_por_cat = {item["categoria"].upper(): item["valor"] for item in data}
    assert valores_por_cat.get("INTERIOR") == 335.0
    assert valores_por_cat.get("CAPITAIS") == 380.0
    assert valores_por_cat.get("CAPITAIS_ESPECIAIS") == 425.0


def test_unidades_valores_diaria_padrao(client, edkallenn_headers):
    """Verifica se as unidades existentes foram atualizadas com o valor da diária de acordo com as regras:
    - Delegacias (DPF/CGE/PB, DPF/PAT/PB): interior (R$ 335,00)
    - Superintendências em Capitais (SR/PF/PB): capitais (R$ 380,00)
    - Capitais especiais (DF, RJ, SP, AM) e Divisões/Diretorias em Brasília: R$ 425,00
    """
    res = client.get("/api/missoes/meta/unidades", headers=edkallenn_headers)
    assert res.status_code == 200
    unidades = {u["sigla"]: u for u in res.json()}

    # Delegacias no interior da PB
    if "DPF/CGE/PB" in unidades:
        assert unidades["DPF/CGE/PB"]["valor_diaria"] == 335.0
        assert unidades["DPF/CGE/PB"]["categoria_diaria"].upper() == "INTERIOR"

    if "DPF/PAT/PB" in unidades:
        assert unidades["DPF/PAT/PB"]["valor_diaria"] == 335.0
        assert unidades["DPF/PAT/PB"]["categoria_diaria"].upper() == "INTERIOR"

    # SR/PF/PB capital normal
    if "SR/PF/PB" in unidades:
        assert unidades["SR/PF/PB"]["valor_diaria"] == 380.0
        assert unidades["SR/PF/PB"]["categoria_diaria"].upper() == "CAPITAIS"

    # SRs especiais
    for sigla in ["SR/PF/DF", "SR/PF/RJ", "SR/PF/SP", "SR/PF/AM"]:
        if sigla in unidades:
            assert unidades[sigla]["valor_diaria"] == 425.0
            assert unidades[sigla]["categoria_diaria"].upper() == "CAPITAIS_ESPECIAIS"


def test_meta_setores_pb(client, edkallenn_headers):
    """Verifica se os 52 setores de destino vinculados à SR/PF/PB foram cadastrados e retornados."""
    res = client.get("/api/missoes/meta/setores?unidade_sigla=SR/PF/PB", headers=edkallenn_headers)
    assert res.status_code == 200
    setores = res.json()
    assert len(setores) >= 52

    siglas = {s["sigla"] for s in setores}
    setores_esperados = [
        "BAN", "CONFGEST", "CONFREG", "COR", "COREG", "CPL", "CS", "DELEAQ", "DELECIBER",
        "DELECOR", "DELEFAZ", "DELEFIN", "DELEMAPH", "DELEMIG", "DELEPAT", "DELEPREV", "DELESP",
        "DELINST", "DMA", "DRE", "DREX", "DRPJ", "FORÇA-TAREFA", "GAB", "GAB/SR", "GAT", "GID",
        "GINQ", "GIP", "GPI", "GTED", "INVENTARIO", "NAD", "NEOF", "NEPOM", "NO", "NTI", "NUCART",
        "NUCRIM", "NUMAT", "NUPCRIM", "NUPREV", "NUTEL", "NUTRAN", "PLANTAO", "PROTOCOLO",
        "SEADM", "SELOG", "SETEC", "SIP", "UAMB", "UTO"
    ]
    for esperado in setores_esperados:
        assert esperado in siglas, f"Setor esperado {esperado} não encontrado na lista de setores."


def test_criar_missao_com_transporte_e_multiplos_servidores(client, edkallenn_headers):
    """Verifica a criação de missão com meio de transporte, custo estimado de passagens,
    setor de destino e inserção de múltiplos servidores (missão por equipe)."""
    res_srv = client.get("/api/servidores?ativo=true", headers=edkallenn_headers)
    assert res_srv.status_code == 200
    servidores = res_srv.json()
    assert len(servidores) >= 2
    mat1 = servidores[0]["matricula"]
    mat2 = servidores[1]["matricula"]

    payload = {
        "codigo_missao": "MIS-2026-TESTEQ01",
        "titulo": "Operação Teste Integrada Aérea e Terrestre",
        "justificativa": "Investigação com deslocamento aéreo prioritário",
        "tipo_missao": "Operacional / Repressão",
        "modalidade": "EQUIPE",
        "meio_transporte": "AEREO",
        "custo_estimado_passagens": 2400.0,
        "setor_destino": "DRPJ",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "DPF/CGE/PB",
        "localidade_descricao": "Campina Grande / PB",
        "data_inicio": "2026-06-01",
        "data_termino": "2026-06-05",
        "valor_diaria_padrao": 335.0,
        "servidores_matriculas": [mat1, mat2]
    }

    res = client.post("/api/missoes", json=payload, headers=edkallenn_headers)
    assert res.status_code == 201, f"Erro ao criar missão: {res.text}"
    missao = res.json()

    assert missao["modalidade"] == "EQUIPE"
    assert missao["meio_transporte"] == "AEREO"
    assert missao["custo_estimado_passagens"] == 2400.0
    assert missao["setor_destino"] == "DRPJ"
    assert len(missao["participantes"]) == 2

    mats_presentes = {p["servidor_matricula"] for p in missao["participantes"]}
    assert mat1 in mats_presentes
    assert mat2 in mats_presentes


def test_modalidade_padrao_individual(client, edkallenn_headers):
    """Verifica se a missão individual é a modalidade padrão quando não especificada."""
    payload = {
        "codigo_missao": "MIS-2026-TESTIND01",
        "titulo": "Missão Padrão Sem Especificar Modalidade",
        "justificativa": "Verificação de modalidade padrão",
        "tipo_missao": "Inteligência / Análise",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "DPF/PAT/PB",
        "localidade_descricao": "Patos / PB",
        "data_inicio": "2026-07-01",
        "data_termino": "2026-07-04"
    }

    res = client.post("/api/missoes", json=payload, headers=edkallenn_headers)
    assert res.status_code == 201, f"Erro ao criar missão: {res.text}"
    missao = res.json()
    assert missao["modalidade"] == "INDIVIDUAL"


def test_status_oficiais_transicoes(client, edkallenn_headers):
    """Testa transições pelos status oficiais definidos na imagem do usuário."""
    payload = {
        "codigo_missao": "MIS-2026-TESTSTAT01",
        "titulo": "Missão Fluxo Oficial de Status",
        "justificativa": "Teste do ciclo de vida oficial",
        "tipo_missao": "Operacional / Repressão",
        "modalidade": "INDIVIDUAL",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "DPF/CGE/PB",
        "localidade_descricao": "Campina Grande / PB",
        "data_inicio": "2026-08-01",
        "data_termino": "2026-08-05"
    }
    res = client.post("/api/missoes", json=payload, headers=edkallenn_headers)
    assert res.status_code == 201, f"Erro ao criar missão: {res.text}"

    # Cadeia de status oficiais
    status_sequencia = [
        "Indicado",
        "Pendente de Alocação",
        "SAT pendente",
        "SAT Atendida",
        "OM EMITIDA",
        "PCDP CADASTRADA",
        "PCDP ENCAMINHADA",
        "PCDP PRESTAR CONTAS",
        "Concluído"
    ]

    for status in status_sequencia:
        patch_res = client.patch(
            "/api/missoes/MIS-2026-TESTSTAT01/status",
            json={"novo_status": status, "justificativa": f"Avanço para {status}"},
            headers=edkallenn_headers
        )
        assert patch_res.status_code == 200, f"Falha ao transicionar para {status}: {patch_res.text}"
        assert patch_res.json()["status_atual"].upper() == status.upper()


def test_dashboard_summary_novos_indicadores(client, edkallenn_headers):
    """Verifica se o summary do dashboard inclui os novos campos exigidos:
    - Diárias pagas para SR/PB, DPF/CGE/PB e DPF/PAT/PB
    - Total gasto com passagens aéreas PB
    - Contadores por status (SCDP, Prestação de Contas, OM, Concluída)
    - Alerta de passagem aérea de 17 dias
    """
    res = client.get("/api/dashboard/summary", headers=edkallenn_headers)
    assert res.status_code == 200
    data = res.json()

    # Campos de diárias PB
    assert "diarias_sr_pb" in data
    assert "diarias_cge_pb" in data
    assert "diarias_pat_pb" in data
    assert isinstance(data["diarias_sr_pb"], (int, float))
    assert isinstance(data["diarias_cge_pb"], (int, float))
    assert isinstance(data["diarias_pat_pb"], (int, float))

    # Campos de passagens aéreas
    assert "passagens_total_pb" in data
    assert isinstance(data["passagens_total_pb"], (int, float))

    # Contadores de status específicos
    assert "servidores_cadastrar_scdp" in data
    assert "servidores_prestacao_contas_pendente" in data
    assert "servidores_om_pendente" in data
    assert "servidores_missao_concluida" in data
    assert "custo_total_geral" in data

    # Alertas
    assert "alertas" in data
    assert isinstance(data["alertas"], list)

    # Gráficos de setores e passagens
    res_charts = client.get("/api/dashboard/charts", headers=edkallenn_headers)
    assert res_charts.status_code == 200
    charts_data = res_charts.json()
    assert "passagens_por_setor" in charts_data
    assert "passagens_por_unidade" in charts_data
    assert "diarias_por_cargo" in charts_data


def test_dashboard_filtros_hot(client, edkallenn_headers):
    """Testa os filtros do dashboard (ano, mês, trimestre, semestre, bimestre, cargo, unidade_pb, setor, meio_transporte)."""
    filtros = [
        {"ano": "2026", "trimestre": "1"},
        {"ano": "2026", "semestre": "1"},
        {"ano": "2026", "bimestre": "2"},
        {"unidade_pb": "SR/PF/PB"},
        {"setor": "DRPJ"},
        {"meio_transporte": "AEREO"},
        {"cargo": "APF"},
        {"status": "OM EMITIDA"}
    ]

    for f in filtros:
        res = client.get("/api/dashboard/summary", params=f, headers=edkallenn_headers)
        assert res.status_code == 200, f"Falha ao consultar dashboard com filtro {f}: {res.text}"
        data = res.json()
        assert "total_missoes" in data
        assert "custo_total_geral" in data


def test_criar_missao_com_servidores_equipe_matriculas_alias(client, edkallenn_headers):
    """Testa criação de missão em equipe utilizando o campo alternativo servidores_equipe_matriculas."""
    res_srv = client.get("/api/servidores?ativo=true", headers=edkallenn_headers)
    servidores = res_srv.json()
    mat1 = servidores[0]["matricula"]
    mat2 = servidores[1]["matricula"]

    payload = {
        "codigo_missao": "MIS-2026-ALIAS-EQ01",
        "titulo": "Operação Teste Alias Equipe",
        "justificativa": "Teste do payload com chave servidores_equipe_matriculas",
        "tipo_missao": "Operacional / Repressão",
        "modalidade": "EQUIPE",
        "meio_transporte": "AEREO",
        "custo_estimado_passagens": 1800.0,
        "setor_destino": "SELOG",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "DPF/PAT/PB",
        "localidade_descricao": "Patos / PB",
        "data_inicio": "2026-09-01",
        "data_termino": "2026-09-05",
        "servidores_equipe_matriculas": [mat1, mat2]
    }

    res = client.post("/api/missoes", json=payload, headers=edkallenn_headers)
    assert res.status_code == 201, f"Erro: {res.text}"
    missao = res.json()
    assert len(missao["participantes"]) == 2
    mats = {p["servidor_matricula"] for p in missao["participantes"]}
    assert mat1 in mats and mat2 in mats


def test_alerta_passagem_aerea_com_servidores_nomes(client, edkallenn_headers):
    """Verifica se o alerta de passagens aéreas (17 dias) lista os nomes de todos os policiais escalados."""
    hoje = date.today()
    dt_inicio = (hoje + timedelta(days=10)).isoformat()
    dt_fim = (hoje + timedelta(days=15)).isoformat()

    res_srv = client.get("/api/servidores?ativo=true", headers=edkallenn_headers)
    servidor = res_srv.json()[0]

    payload = {
        "codigo_missao": "MIS-2026-VOO-17D",
        "titulo": "Missão Urgente com Bilhete Aéreo em 10 dias",
        "justificativa": "Operação emergencial interestadual",
        "tipo_missao": "Operacional / Repressão",
        "modalidade": "INDIVIDUAL",
        "meio_transporte": "AEREO",
        "custo_estimado_passagens": 2200.0,
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "SR/PF/DF",
        "localidade_descricao": "Brasília / DF",
        "data_inicio": dt_inicio,
        "data_termino": dt_fim,
        "missionario_matricula": servidor["matricula"]
    }

    res = client.post("/api/missoes", json=payload, headers=edkallenn_headers)
    assert res.status_code == 201

    res_dash = client.get("/api/dashboard/summary", headers=edkallenn_headers)
    assert res_dash.status_code == 200
    alertas = res_dash.json().get("alertas", [])

    alerta_voo = next((a for a in alertas if a.get("codigo_missao") == "MIS-2026-VOO-17D"), None)
    assert alerta_voo is not None, "Alerta de passagem aérea de 17 dias não foi disparado para a missão criada."
    assert "servidores_nomes" in alerta_voo
    assert isinstance(alerta_voo["servidores_nomes"], list)
    assert len(alerta_voo["servidores_nomes"]) >= 1
    assert any(servidor["nome_completo"] in nome for nome in alerta_voo["servidores_nomes"])


def test_unidade_crud_com_valor_e_categoria_diaria(client, edkallenn_headers):
    """Testa criação e edição de unidade contemplando valor_diaria, categoria_diaria e tipo_unidade."""
    sigla = "DPF/TESTE/PB"
    payload = {
        "sigla": sigla,
        "nome_extenso": "Delegacia Teste no Interior da PB",
        "municipio": "Guarabira",
        "uf": "PB",
        "valor_diaria": 335.0,
        "categoria_diaria": "INTERIOR",
        "tipo_unidade": "DELEGACIA",
        "is_fronteira": False,
        "ativo": True
    }

    # Criar
    res = client.post("/api/missoes/meta/unidades", json=payload, headers=edkallenn_headers)
    assert res.status_code == 201, f"Erro: {res.text}"
    unid_criada = res.json()
    assert unid_criada["sigla"] == sigla
    assert unid_criada["valor_diaria"] == 335.0
    assert unid_criada["categoria_diaria"] == "INTERIOR"
    assert unid_criada["tipo_unidade"] == "DELEGACIA"

    # Atualizar
    update_payload = {
        "valor_diaria": 380.0,
        "categoria_diaria": "CAPITAIS",
        "tipo_unidade": "SUPERINTENDENCIA"
    }
    res_up = client.put(f"/api/missoes/meta/unidades/{sigla}", json=update_payload, headers=edkallenn_headers)
    assert res_up.status_code == 200
    unid_atualizada = res_up.json()
    assert unid_atualizada["valor_diaria"] == 380.0
    assert unid_atualizada["categoria_diaria"] == "CAPITAIS"


def test_atualizar_valor_diaria_oficial_propaga_unidades(client, edkallenn_headers):
    """Testa atualização de categoria de diária oficial via PUT e propagação para unidades."""
    # Atualiza INTERIOR para 337.00
    res = client.put(
        "/api/missoes/meta/valores-diarias/INTERIOR",
        json={"valor": 337.0},
        headers=edkallenn_headers
    )
    assert res.status_code == 200
    assert res.json()["valor"] == 337.0

    # Verifica se DPF/CGE/PB refletiu o novo valor
    res_unid = client.get("/api/missoes/meta/unidades", headers=edkallenn_headers)
    unidades = {u["sigla"]: u for u in res_unid.json()}
    if "DPF/CGE/PB" in unidades:
        assert unidades["DPF/CGE/PB"]["valor_diaria"] == 337.0

    # Restaura valor padrão oficial R$ 335.00
    res_restaura = client.put(
        "/api/missoes/meta/valores-diarias/INTERIOR",
        json={"valor": 335.0},
        headers=edkallenn_headers
    )
    assert res_restaura.status_code == 200
    assert res_restaura.json()["valor"] == 335.0


def _criar_servidor_teste(client, headers, matricula, nome_guerra, nome_completo):
    existentes = client.get("/api/servidores", headers=headers).json()
    for s in existentes:
        if s["matricula"] == matricula:
            return s
    res = client.post(
        "/api/servidores",
        json={
            "matricula": matricula,
            "nome_completo": nome_completo,
            "nome_guerra": nome_guerra,
            "cargo_sigla": "APF",
            "unidade_sigla": "SR/PF/PB",
            "email_institucional": f"{matricula.lower()}@pf.gov.br",
            "telefone_celular": "83999990000",
            "is_missionario_geral": True,
            "ativo": True
        },
        headers=headers
    )
    assert res.status_code in (200, 201), res.text
    return res.json()


def test_criar_missao_individual_sem_codigo_sem_chefe_e_justificativa_vazia(client, edkallenn_headers):
    """Garante criação de missão INDIVIDUAL sem código, sem chefe e com justificativa opcional."""
    srv = _criar_servidor_teste(client, edkallenn_headers, "PF99881", "GUERRAIND1", "Servidor Teste Individual Sem Codigo")

    payload = {
        "titulo": "Diligência Individual Sem Código e Sem Justificativa",
        "justificativa": "",
        "tipo_missao": "Inteligência / Análise",
        "modalidade": "INDIVIDUAL",
        "meio_transporte": "TERRESTRE",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "DPF/CGE/PB",
        "localidade_descricao": "Campina Grande / PB",
        "data_inicio": "2026-11-10",
        "data_termino": "2026-11-12",
        "missionario_matricula": srv["matricula"],
        "responsavel_matricula": None
    }

    res = client.post("/api/missoes", json=payload, headers=edkallenn_headers)
    assert res.status_code == 201, f"Erro ao criar missão sem código/chefe/justificativa: {res.text}"
    m = res.json()

    assert m["codigo_missao"].startswith("MIS-2026-")
    assert m["justificativa"] == ""
    assert m["responsavel_matricula"] is None
    assert m["missionario_matricula"] == srv["matricula"]
    assert m["missionario_nome_guerra"] == srv.get("nome_guerra")
    assert m["status_atual"] == "Pendente de Alocação"
    assert len(m["participantes"]) == 1
    assert m["participantes"][0]["servidor_nome_guerra"] == srv.get("nome_guerra")


def test_status_oficiais_unificados_transicao_e_filtros(client, edkallenn_headers):
    """Testa transição para todos os 11 status oficiais e verifica que todos retornam nos filtros."""
    from urllib.parse import quote
    from app.status_utils import OFFICIAL_STATUSES

    srv = _criar_servidor_teste(client, edkallenn_headers, "PF99882", "GUERRASTAT2", "Servidor Teste Status Unificados")

    payload = {
        "titulo": "Missão Teste Status Unificados 2026",
        "justificativa": "",
        "tipo_missao": "Operacional / Repressão",
        "modalidade": "INDIVIDUAL",
        "meio_transporte": "TERRESTRE",
        "unidade_solicitante": "SR/PF/PB",
        "unidade_destino": "DPF/PAT/PB",
        "localidade_descricao": "Patos / PB",
        "data_inicio": "2026-11-20",
        "data_termino": "2026-11-22",
        "missionario_matricula": srv["matricula"],
        "status_atual": "Indicado"
    }
    res_create = client.post("/api/missoes", json=payload, headers=edkallenn_headers)
    assert res_create.status_code == 201, res_create.text
    missao_id = res_create.json()["id"]

    for st in OFFICIAL_STATUSES:
        res_patch = client.patch(
            f"/api/missoes/{missao_id}/status",
            json={"novo_status": st, "observacao": f"Transição para {st}"},
            headers=edkallenn_headers
        )
        assert res_patch.status_code == 200, f"Falha ao mudar para {st}: {res_patch.text}"
        assert res_patch.json()["status_atual"] == st

        res_list = client.get(
            f"/api/missoes?status={quote(st)}&ano=2026&modalidade=INDIVIDUAL",
            headers=edkallenn_headers
        )
        assert res_list.status_code == 200
        ids = {item["id"] for item in res_list.json()}
        assert missao_id in ids, f"Missão {missao_id} não retornou no filtro status={st}"

        res_dash = client.get(
            f"/api/dashboard/summary?status={quote(st)}&ano=2026&modalidade=INDIVIDUAL",
            headers=edkallenn_headers
        )
        assert res_dash.status_code == 200
        assert res_dash.json()["total_missoes"] >= 1

        # Regressão: PCDP CADASTRADA não deve vazar no filtro OM EMITIDA
        if st == "PCDP CADASTRADA":
            res_om = client.get(
                f"/api/missoes?status={quote('OM EMITIDA')}&ano=2026&modalidade=INDIVIDUAL",
                headers=edkallenn_headers
            )
            assert missao_id not in {item["id"] for item in res_om.json()}


def test_busca_e_exportacao_nome_guerra(client, edkallenn_headers):
    """Verifica busca por nome_guerra na API de missões e presença nas exportações CSV/XLSX."""
    from urllib.parse import quote

    mat_unica = "PF99887"
    _criar_servidor_teste(client, edkallenn_headers, mat_unica, "GUERRAX99", "Carlos Augusto Ferreira Testa")

    res_create = client.post(
        "/api/missoes",
        json={
            "titulo": "Missão Busca Nome Guerra Unica",
            "justificativa": "",
            "tipo_missao": "Administrativa / Correição",
            "modalidade": "INDIVIDUAL",
            "meio_transporte": "TERRESTRE",
            "unidade_solicitante": "SR/PF/PB",
            "unidade_destino": "DPF/CGE/PB",
            "localidade_descricao": "Campina Grande / PB",
            "data_inicio": "2026-10-05",
            "data_termino": "2026-10-06",
            "missionario_matricula": mat_unica,
            "status_atual": "SAT pendente"
        },
        headers=edkallenn_headers
    )
    assert res_create.status_code == 201, res_create.text
    missao_id = res_create.json()["id"]

    res_q = client.get(f"/api/missoes?q={quote('GUERRAX99')}", headers=edkallenn_headers)
    assert res_q.status_code == 200
    assert missao_id in {m["id"] for m in res_q.json()}

    res_csv = client.get("/api/export/missoes.csv", headers=edkallenn_headers)
    assert res_csv.status_code == 200
    csv_text = res_csv.content.decode("utf-8-sig")
    assert "Nome Guerra" in csv_text
    assert "GUERRAX99" in csv_text

    res_xlsx = client.get("/api/export/missoes.xlsx", headers=edkallenn_headers)
    assert res_xlsx.status_code == 200


