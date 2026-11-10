def test_list_missoes(client, admin_headers):
    res = client.get("/api/missoes", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 3
    # Verifica presença da missão seed
    cods = [m["codigo_missao"] for m in data]
    assert "MIS-2026-00101" in cods

def test_create_missao(client, admin_headers):
    payload = {
        "codigo_missao": "MIS-2026-TEST01",
        "titulo": "Operação Teste de Integração",
        "justificativa": "Validação de conformidade automatizada",
        "tipo_missao": "Operacional / Repressão",
        "unidade_solicitante": "SR/PF/DF",
        "unidade_destino": "SR/PF/AM",
        "localidade_descricao": "Manaus/AM",
        "data_inicio": "2026-08-01",
        "data_termino": "2026-08-10",
        "valor_diaria_padrao": 425.00,
        "status_atual": "RASCUNHO"
    }
    res = client.post("/api/missoes", json=payload, headers=admin_headers)
    assert res.status_code == 201
    m = res.json()
    assert m["codigo_missao"] == "MIS-2026-TEST01"
    assert m["total_dias"] == 10
    assert m["status_atual"] == "RASCUNHO"

def test_workflow_state_transition(client, admin_headers):
    # Alterar status para SOLICITADA e depois APROVADA
    res1 = client.patch(
        "/api/missoes/MIS-2026-TEST01/status",
        json={"novo_status": "SOLICITADA", "justificativa": "Envio formal"},
        headers=admin_headers
    )
    assert res1.status_code == 200
    assert res1.json()["status_atual"] == "SOLICITADA"

    res2 = client.patch(
        "/api/missoes/MIS-2026-TEST01/status",
        json={"novo_status": "APROVADA", "justificativa": "Aprovado pela chefia"},
        headers=admin_headers
    )
    assert res2.status_code == 200
    assert res2.json()["status_atual"] == "APROVADA"

def test_add_participant_and_diarias_calculation(client, admin_headers):
    # Alexandre Silveira (10293) é de Cascavel/PR -> missão em Manaus/AM (não é sede)
    part_payload = {
        "servidor_matricula": "10293",
        "papel": "Operador Tático",
        "meio_transporte": "AEREO",
        "data_apresentacao": "2026-08-01",
        "data_retorno": "2026-08-10",
        "valor_diaria_unitaria": 425.00,
        "valor_passagem_aerea": 1800.00,
        "localizador_aereo": "TEST99",
        "is_missao_sede": False
    }
    res = client.post("/api/missoes/MIS-2026-TEST01/participantes", json=part_payload, headers=admin_headers)
    assert res.status_code == 201
    m = res.json()
    assert len(m["participantes"]) == 1
    p = m["participantes"][0]
    assert p["dias_participacao"] == 10
    assert p["qtd_diarias"] == 9.5
    assert p["valor_total_diarias"] == 4037.50
    assert p["custo_total_servidor"] == 4037.50 + 1800.00

def test_editable_daily_allowance_recalculation(client, admin_headers):
    """
    CAMPO EDITÁVEL DA DIÁRIA:
    Alterar o valor da diária da missão de 425.00 para 500.00
    e verificar que o participante vinculado foi recalculado:
    9.5 diárias * 500.00 = 4750.00
    """
    res = client.patch(
        "/api/missoes/MIS-2026-TEST01/valor-diaria",
        json={"novo_valor_diaria": 500.00, "recalcular_participantes": True},
        headers=admin_headers
    )
    assert res.status_code == 200
    m = res.json()
    assert m["valor_diaria_padrao"] == 500.00

    p = m["participantes"][0]
    assert p["valor_diaria_unitaria"] == 500.00
    assert p["qtd_diarias"] == 9.5
    assert p["valor_total_diarias"] == 4750.00
    assert p["custo_total_servidor"] == 4750.00 + 1800.00

def test_schedule_conflict_detection(client, admin_headers):
    """
    Tentativa de alocar o mesmo servidor em outra missão no mesmo período
    deve resultar em erro 409 (Conflict).
    """
    # Criar uma segunda missão com datas sobrepostas (2026-08-05 a 2026-08-15)
    client.post("/api/missoes", json={
        "codigo_missao": "MIS-2026-CONFLITO",
        "titulo": "Missão Conflitante",
        "justificativa": "Teste",
        "tipo_missao": "Operacional / Repressão",
        "unidade_solicitante": "SR/PF/DF",
        "localidade_descricao": "Brasília/DF",
        "data_inicio": "2026-08-05",
        "data_termino": "2026-08-15",
        "valor_diaria_padrao": 425.00
    }, headers=admin_headers)

    # Tentar adicionar Alexandre Silveira (10293)
    res_conflict = client.post("/api/missoes/MIS-2026-CONFLITO/participantes", json={
        "servidor_matricula": "10293",
        "papel": "Instrutor",
        "meio_transporte": "VIATURA_OFICIAL",
        "data_apresentacao": "2026-08-05",
        "data_retorno": "2026-08-15",
        "valor_diaria_unitaria": 425.00
    }, headers=admin_headers)

    assert res_conflict.status_code == 409
    assert "Conflito de agenda" in res_conflict.json()["detail"]
