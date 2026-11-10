from datetime import date, timedelta
from typing import List, Dict, Any
from fastapi import APIRouter, Depends
from app.schemas import DashboardSummary, AlertItem
from app.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard Executivo"])

@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(current_user: dict = Depends(get_current_user)):
    today = date.today().isoformat()
    alerts: List[AlertItem] = []

    with get_db() as conn:
        # Total de missões
        tot_missoes = conn.execute("SELECT COUNT(*) as cnt FROM missoes WHERE status_atual != 'CANCELADA'").fetchone()["cnt"]
        
        # Missões em andamento
        em_andamento = conn.execute("SELECT COUNT(*) as cnt FROM missoes WHERE status_atual = 'EM_ANDAMENTO'").fetchone()["cnt"]
        
        # Missões em planejamento / tramitação
        planejamento = conn.execute(
            """
            SELECT COUNT(*) as cnt FROM missoes 
            WHERE status_atual IN ('RASCUNHO', 'SOLICITADA', 'EM_ANALISE', 'APROVADA', 'OM_EMITIDA', 'PCDP_TRAMITADA')
            """
        ).fetchone()["cnt"]
        
        # Concluídas
        concluidas = conn.execute("SELECT COUNT(*) as cnt FROM missoes WHERE status_atual = 'CONCLUIDA'").fetchone()["cnt"]
        
        # Servidores ativos
        srv_ativos = conn.execute("SELECT COUNT(*) as cnt FROM servidores WHERE ativo = 1").fetchone()["cnt"]
        
        # Servidores atualmente em missão
        srv_em_missao = conn.execute(
            """
            SELECT COUNT(DISTINCT p.servidor_matricula) as cnt
            FROM missoes_participantes p
            JOIN missoes m ON p.missao_id = m.id
            WHERE m.status_atual = 'EM_ANDAMENTO'
               OR (p.data_apresentacao <= ? AND p.data_retorno >= ? AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA'))
            """,
            (today, today)
        ).fetchone()["cnt"]

        # Custos financeiros
        custos = conn.execute(
            """
            SELECT 
                COALESCE(SUM(p.valor_total_diarias), 0.0) as tot_diarias,
                COALESCE(SUM(p.valor_passagem_aerea), 0.0) as tot_passagens,
                COALESCE(SUM(p.custo_total_servidor), 0.0) as tot_geral
            FROM missoes_participantes p
            JOIN missoes m ON p.missao_id = m.id
            WHERE m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
            """
        ).fetchone()

        # Diária padrão atual
        cfg_diaria = conn.execute("SELECT valor FROM configuracoes WHERE chave = 'valor_diaria_padrao'").fetchone()
        diaria_padrao = float(cfg_diaria["valor"]) if cfg_diaria else 425.00

        # Alertas do Sistema:
        # 1. Missões a iniciar em menos de 5 dias sem PCDP
        alerta_dias_pcdp = 5
        cinco_dias_frente = (date.today() + timedelta(days=alerta_dias_pcdp)).isoformat()
        sem_pcdp = conn.execute(
            """
            SELECT codigo_missao, titulo, data_inicio, status_atual
            FROM missoes
            WHERE (numero_pcdp IS NULL OR numero_pcdp = '')
              AND status_atual IN ('APROVADA', 'OM_EMITIDA')
              AND data_inicio <= ?
            """,
            (cinco_dias_frente,)
        ).fetchall()

        for sp in sem_pcdp:
            alerts.append(AlertItem(
                tipo="PERIGO",
                titulo="Missão Próxima sem PCDP Cadastrada",
                mensagem=f"A missão '{sp['titulo']}' inicia em {sp['data_inicio']} e ainda não possui número de PCDP lançado no SCDP.",
                missao_codigo=sp["codigo_missao"]
            ))

        # 2. Missões finalizadas com prestação de contas pendente (> 5 dias após retorno)
        cinco_dias_atras = (date.today() - timedelta(days=5)).isoformat()
        pendentes_pc = conn.execute(
            """
            SELECT codigo_missao, titulo, data_termino, status_atual
            FROM missoes
            WHERE data_termino <= ?
              AND status_atual IN ('EM_ANDAMENTO', 'PRESTACAO_CONTAS')
            """,
            (cinco_dias_atras,)
        ).fetchall()

        for ppc in pendentes_pc:
            alerts.append(AlertItem(
                tipo="ALERTA",
                titulo="Prazo de Prestação de Contas Excedido",
                mensagem=f"A missão '{ppc['titulo']}' encerrou em {ppc['data_termino']} e requer homologação de bilhetes e relatório de conclusão.",
                missao_codigo=ppc["codigo_missao"]
            ))

        # 3. Servidores com duplicidade/sobreposição de missões ativas
        conflitos = conn.execute(
            """
            SELECT p1.servidor_matricula, s.nome_completo, m1.codigo_missao as m1_cod, m2.codigo_missao as m2_cod
            FROM missoes_participantes p1
            JOIN missoes_participantes p2 ON p1.servidor_matricula = p2.servidor_matricula AND p1.id != p2.id
            JOIN missoes m1 ON p1.missao_id = m1.id
            JOIN missoes m2 ON p2.missao_id = m2.id
            JOIN servidores s ON p1.servidor_matricula = s.matricula
            WHERE m1.status_atual NOT IN ('CANCELADA', 'REJEITADA')
              AND m2.status_atual NOT IN ('CANCELADA', 'REJEITADA')
              AND p1.data_apresentacao <= p2.data_retorno
              AND p2.data_apresentacao <= p1.data_retorno
            GROUP BY p1.servidor_matricula
            """
        ).fetchall()

        for cf in conflitos:
            alerts.append(AlertItem(
                tipo="PERIGO",
                titulo="Conflito de Agenda Detectado",
                mensagem=f"Servidor {cf['nome_completo']} ({cf['servidor_matricula']}) possui sobreposição de datas entre as missões {cf['m1_cod']} e {cf['m2_cod']}.",
                servidor_matricula=cf["servidor_matricula"]
            ))

    return DashboardSummary(
        total_missoes=tot_missoes,
        missoes_em_andamento=em_andamento,
        missoes_planejamento=planejamento,
        missoes_concluidas=concluidas,
        total_servidores_ativos=srv_ativos,
        total_servidores_em_missao=srv_em_missao,
        custo_total_diarias=round(custos["tot_diarias"], 2),
        custo_total_passagens=round(custos["tot_passagens"], 2),
        custo_total_geral=round(custos["tot_geral"], 2),
        valor_diaria_padrao_sistema=diaria_padrao,
        alertas=alerts
    )

@router.get("/charts")
def get_dashboard_charts(current_user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    with get_db() as conn:
        # Por tipo de missão
        por_tipo = conn.execute(
            """
            SELECT tipo_missao, COUNT(*) as qtd
            FROM missoes
            WHERE status_atual != 'CANCELADA'
            GROUP BY tipo_missao
            """
        ).fetchall()

        # Por cargo
        por_cargo = conn.execute(
            """
            SELECT cargo_sigla, COUNT(*) as qtd
            FROM servidores
            WHERE ativo = 1
            GROUP BY cargo_sigla
            """
        ).fetchall()

        # Por status de missão
        por_status = conn.execute(
            """
            SELECT status_atual, COUNT(*) as qtd
            FROM missoes
            GROUP BY status_atual
            """
        ).fetchall()

    return {
        "por_tipo": [dict(r) for r in por_tipo],
        "por_cargo": [dict(r) for r in por_cargo],
        "por_status": [dict(r) for r in por_status]
    }
