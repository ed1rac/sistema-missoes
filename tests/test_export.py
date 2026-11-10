import io
from openpyxl import load_workbook

def test_export_missoes_csv(client, admin_headers):
    res = client.get("/api/export/missoes.csv", headers=admin_headers)
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    content = res.text
    assert "Código da Missão" in content
    assert "MIS-2026-00101" in content

def test_export_missoes_xlsx(client, admin_headers):
    res = client.get("/api/export/missoes.xlsx", headers=admin_headers)
    assert res.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in res.headers["content-type"]
    wb = load_workbook(io.BytesIO(res.content))
    assert "Missões PF" in wb.sheetnames
    assert "Efetivo e Diárias" in wb.sheetnames

def test_export_missoes_json(client, admin_headers):
    res = client.get("/api/export/missoes.json", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["plataforma"] == "SIS-MISSÕES PF"
    assert "missoes" in data
    assert len(data["missoes"]) >= 3

def test_dashboard_summary_and_alerts(client, admin_headers):
    res = client.get("/api/dashboard/summary", headers=admin_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total_missoes"] >= 3
    assert data["total_servidores_ativos"] >= 5
    assert data["valor_diaria_padrao_sistema"] == 425.00
    assert "alertas" in data
