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
