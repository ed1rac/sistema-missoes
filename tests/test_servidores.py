def test_list_servidores(client, admin_headers):
    res = client.get("/api/servidores", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 5
    mats = [s["matricula"] for s in data]
    assert "10293" in mats

def test_filter_servidores_by_cargo(client, admin_headers):
    res = client.get("/api/servidores?cargo=DPF", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert all(s["cargo_sigla"] == "DPF" for s in data)

def test_create_and_update_servidor(client, admin_headers):
    payload = {
        "matricula": "99988",
        "nome_completo": "MARCOS VINICIUS ANDRADE",
        "nome_guerra": "ANDRADE",
        "cargo_sigla": "APF",
        "unidade_sigla": "SR/PF/SP",
        "email_institucional": "andrade.mva@pf.gov.br",
        "telefone_celular": "(11) 98888-7777",
        "tpe": True,
        "is_missionario_geral": True
    }
    res = client.post("/api/servidores", json=payload, headers=admin_headers)
    assert res.status_code == 201
    s = res.json()
    assert s["matricula"] == "99988"
    assert s["tpe"] is True

    # Atualizar servidor
    res_up = client.put("/api/servidores/99988", json={"telefone_celular": "(11) 99999-0000"}, headers=admin_headers)
    assert res_up.status_code == 200
    assert res_up.json()["telefone_celular"] == "(11) 99999-0000"

    # Excluir / Desativar
    res_del = client.delete("/api/servidores/99988", headers=admin_headers)
    assert res_del.status_code == 200
