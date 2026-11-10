import csv
import io
import json
from datetime import datetime
from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from app.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/export", tags=["Exportação e Interoperabilidade"])

@router.get("/missoes.csv")
def export_missoes_csv(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT 
                m.codigo_missao, m.titulo, m.tipo_missao, m.unidade_solicitante,
                m.unidade_destino, m.localidade_descricao, m.data_inicio, m.data_termino,
                m.total_dias, m.status_atual, m.numero_om, m.numero_pcdp, m.valor_diaria_padrao,
                COUNT(p.id) as participantes,
                COALESCE(SUM(p.valor_total_diarias), 0.0) as custo_diarias,
                COALESCE(SUM(p.valor_passagem_aerea), 0.0) as custo_passagens,
                COALESCE(SUM(p.custo_total_servidor), 0.0) as custo_total
            FROM missoes m
            LEFT JOIN missoes_participantes p ON m.id = p.missao_id
            GROUP BY m.id
            ORDER BY m.data_inicio DESC
            """
        ).fetchall()

    output = io.StringIO()
    # UTF-8 BOM para abrir sem corrupção no Excel Windows
    output.write('\ufeff')
    writer = csv.writer(output, delimiter=';')

    writer.writerow([
        "Código da Missão", "Título", "Tipo", "Solicitante", "Destino",
        "Localidade", "Início", "Término", "Dias", "Status", "Nº OM",
        "Nº PCDP", "Valor Diária Base (R$)", "Nº Participantes",
        "Custo Diárias (R$)", "Custo Passagens (R$)", "Custo Total (R$)"
    ])

    for r in rows:
        writer.writerow([
            r["codigo_missao"], r["titulo"], r["tipo_missao"], r["unidade_solicitante"],
            r["unidade_destino"] or "", r["localidade_descricao"], r["data_inicio"],
            r["data_termino"], r["total_dias"], r["status_atual"], r["numero_om"] or "",
            r["numero_pcdp"] or "", f"{r['valor_diaria_padrao']:.2f}", r["participantes"],
            f"{r['custo_diarias']:.2f}", f"{r['custo_passagens']:.2f}", f"{r['custo_total']:.2f}"
        ])

    output.seek(0)
    filename = f"missoes_pf_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/missoes.xlsx")
def export_missoes_xlsx(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        missoes = conn.execute(
            """
            SELECT 
                m.codigo_missao, m.titulo, m.tipo_missao, m.unidade_solicitante,
                m.unidade_destino, m.localidade_descricao, m.data_inicio, m.data_termino,
                m.total_dias, m.status_atual, m.numero_om, m.numero_pcdp, m.valor_diaria_padrao,
                COUNT(p.id) as participantes,
                COALESCE(SUM(p.valor_total_diarias), 0.0) as custo_diarias,
                COALESCE(SUM(p.valor_passagem_aerea), 0.0) as custo_passagens,
                COALESCE(SUM(p.custo_total_servidor), 0.0) as custo_total
            FROM missoes m
            LEFT JOIN missoes_participantes p ON m.id = p.missao_id
            GROUP BY m.id
            ORDER BY m.data_inicio DESC
            """
        ).fetchall()

        participantes = conn.execute(
            """
            SELECT 
                m.codigo_missao, m.titulo as missao_titulo, p.servidor_matricula,
                s.nome_completo, s.cargo_sigla, s.unidade_sigla, p.papel,
                p.meio_transporte, p.data_apresentacao, p.data_retorno,
                p.dias_participacao, p.is_missao_sede, p.qtd_diarias,
                p.valor_diaria_unitaria, p.valor_total_diarias, p.valor_passagem_aerea,
                p.custo_total_servidor, p.localizador_aereo
            FROM missoes_participantes p
            JOIN missoes m ON p.missao_id = m.id
            JOIN servidores s ON p.servidor_matricula = s.matricula
            ORDER BY m.codigo_missao DESC, s.nome_completo ASC
            """
        ).fetchall()

    wb = Workbook()
    
    # Aba 1: Resumo das Missões
    ws1 = wb.active
    ws1.title = "Missões PF"

    header_fill = PatternFill(start_color="0B2F64", end_color="0B2F64", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    border_thin = Border(
        left=Side(style='thin', color='DDDDDD'),
        right=Side(style='thin', color='DDDDDD'),
        top=Side(style='thin', color='DDDDDD'),
        bottom=Side(style='thin', color='DDDDDD')
    )

    headers1 = [
        "Código", "Título da Missão", "Tipo", "Solicitante", "Destino",
        "Localidade", "Início", "Término", "Dias", "Status", "OM",
        "PCDP", "Valor Diária (R$)", "Efetivo", "Diárias (R$)", "Passagens (R$)", "Total (R$)"
    ]
    ws1.append(headers1)

    for col_num in range(1, len(headers1) + 1):
        cell = ws1.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for r in missoes:
        ws1.append([
            r["codigo_missao"], r["titulo"], r["tipo_missao"], r["unidade_solicitante"],
            r["unidade_destino"] or "", r["localidade_descricao"], r["data_inicio"],
            r["data_termino"], r["total_dias"], r["status_atual"], r["numero_om"] or "",
            r["numero_pcdp"] or "", r["valor_diaria_padrao"], r["participantes"],
            r["custo_diarias"], r["custo_passagens"], r["custo_total"]
        ])

    # Aba 2: Participantes e Diárias
    ws2 = wb.create_sheet(title="Efetivo e Diárias")
    headers2 = [
        "Código Missão", "Missão", "Matrícula", "Servidor", "Cargo",
        "Lotação", "Papel", "Transporte", "Apresentação", "Retorno",
        "Dias", "Sede (Sem Diária)", "Qtd Diárias", "Valor Unitário (R$)",
        "Total Diárias (R$)", "Passagem (R$)", "Custo Total (R$)", "Localizador"
    ]
    ws2.append(headers2)

    for col_num in range(1, len(headers2) + 1):
        cell = ws2.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for p in participantes:
        ws2.append([
            p["codigo_missao"], p["missao_titulo"], p["servidor_matricula"],
            p["nome_completo"], p["cargo_sigla"], p["unidade_sigla"], p["papel"],
            p["meio_transporte"], p["data_apresentacao"], p["data_retorno"],
            p["dias_participacao"], "Sim" if p["is_missao_sede"] else "Não",
            p["qtd_diarias"], p["valor_diaria_unitaria"], p["valor_total_diarias"],
            p["valor_passagem_aerea"], p["custo_total_servidor"], p["localizador_aereo"] or ""
        ])

    # Auto ajuste de largura das colunas
    for ws in [ws1, ws2]:
        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = col[0].column_letter
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)

    filename = f"relatorio_missoes_pf_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return Response(
        content=stream.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/missoes.json")
def export_missoes_json(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        missoes = conn.execute("SELECT * FROM missoes ORDER BY data_inicio DESC").fetchall()
        result = []
        for m in missoes:
            m_dict = dict(m)
            parts = conn.execute(
                """
                SELECT p.*, s.nome_completo, s.cargo_sigla, s.unidade_sigla
                FROM missoes_participantes p
                JOIN servidores s ON p.servidor_matricula = s.matricula
                WHERE p.missao_id = ?
                """,
                (m["id"],)
            ).fetchall()
            m_dict["participantes"] = [dict(p) for p in parts]
            result.append(m_dict)

    payload = {
        "plataforma": "SIS-MISSÕES PF",
        "versao": "2.0",
        "timestamp": datetime.now().isoformat(),
        "total_registros": len(result),
        "missoes": result
    }
    return Response(
        content=json.dumps(payload, indent=2, ensure_ascii=False),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=missoes_pf_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"}
    )
