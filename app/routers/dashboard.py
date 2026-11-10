from datetime import date, timedelta
from typing import List, Dict, Any, Optional
from collections import defaultdict
from fastapi import APIRouter, Depends, Query
from app.schemas import DashboardSummary, AlertItem
from app.auth import get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard Executivo"])

def _build_missao_filter(
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    trimestre: Optional[int] = None,
    semestre: Optional[int] = None,
    bimestre: Optional[int] = None,
    cargo: Optional[str] = None,
    unidade_pb: Optional[str] = None,
    setor: Optional[str] = None,
    meio_transporte: Optional[str] = None,
    data_de: Optional[str] = None,
    data_ate: Optional[str] = None,
    status: Optional[str] = None,
    tipo: Optional[str] = None,
    solicitante: Optional[str] = None,
    destino: Optional[str] = None,
    modalidade: Optional[str] = None,
    alias: str = "m"
):
    where = " WHERE 1=1"
    params = []

    if status:
        st = status.strip()
        st_upper = st.upper()
        if st_upper in ("CADASTRO_SCDP", "CADASTRAR_SCDP", "PCDP_CADASTRADA", "PCDP CADASTRADA"):
            where += f" AND {alias}.status_atual IN ('PCDP CADASTRADA', 'PCDP_CADASTRADA', 'PCDP_TRAMITADA', 'OM_EMITIDA', 'OM EMITIDA')"
        elif st_upper in ("PRESTACAO_CONTAS_PENDENTE", "PRESTACAO_CONTAS", "PCDP_PRESTAR_CONTAS", "PCDP PRESTAR CONTAS"):
            where += f" AND {alias}.status_atual IN ('PRESTACAO_CONTAS', 'PCDP PRESTAR CONTAS', 'PCDP_PRESTAR_CONTAS')"
        elif st_upper in ("OM_PENDENTE", "OM PENDENTE"):
            where += f" AND {alias}.status_atual IN ('APROVADA', 'SAT ATENDIDA', 'SAT_ATENDIDA', 'SAT PENDENTE', 'INDICADO', 'PENDENTE DE ALOCAÇÃO', 'PENDENTE DE ALOCACAO')"
        elif st_upper in ("CONCLUIDA", "CONCLUIDO", "CONCLUÍDO", "CONCLUÍDA"):
            where += f" AND {alias}.status_atual IN ('CONCLUIDA', 'CONCLUIDO', 'Concluído', 'CONCLUÍDA')"
        else:
            where += f" AND UPPER({alias}.status_atual) = ?"
            params.append(st_upper)

    if tipo:
        where += f" AND {alias}.tipo_missao = ?"
        params.append(tipo)

    if solicitante:
        where += f" AND {alias}.unidade_solicitante = ?"
        params.append(solicitante)

    if destino:
        where += f" AND {alias}.unidade_destino = ?"
        params.append(destino)

    if unidade_pb:
        u_pb = unidade_pb.strip().upper()
        if "CGE" in u_pb:
            where += f" AND ({alias}.unidade_solicitante LIKE '%CGE%' OR {alias}.unidade_destino LIKE '%CGE%')"
        elif "PAT" in u_pb:
            where += f" AND ({alias}.unidade_solicitante LIKE '%PAT%' OR {alias}.unidade_destino LIKE '%PAT%')"
        elif "SR" in u_pb or "PB" in u_pb:
            where += f" AND ({alias}.unidade_solicitante = 'SR/PF/PB' OR {alias}.unidade_destino = 'SR/PF/PB')"
        else:
            where += f" AND ({alias}.unidade_solicitante = ? OR {alias}.unidade_destino = ?)"
            params.extend([unidade_pb, unidade_pb])

    if setor:
        where += f" AND {alias}.setor_destino = ?"
        params.append(setor.strip().upper())

    if meio_transporte:
        where += f" AND ({alias}.meio_transporte = ? OR EXISTS (SELECT 1 FROM missoes_participantes mp_transp WHERE mp_transp.missao_id = {alias}.id AND mp_transp.meio_transporte = ?))"
        params.extend([meio_transporte.upper(), meio_transporte.upper()])

    if modalidade:
        where += f" AND {alias}.modalidade = ?"
        params.append(modalidade.upper())

    if ano:
        where += f" AND (strftime('%Y', {alias}.data_inicio) = ? OR strftime('%Y', {alias}.data_termino) = ?)"
        params.extend([str(ano), str(ano)])

    if mes:
        mes_str = f"{mes:02d}"
        where += f" AND (strftime('%m', {alias}.data_inicio) = ? OR strftime('%m', {alias}.data_termino) = ?)"
        params.extend([mes_str, mes_str])
    elif bimestre:
        b_map = {
            1: ('01', '02'),
            2: ('03', '04'),
            3: ('05', '06'),
            4: ('07', '08'),
            5: ('09', '10'),
            6: ('11', '12'),
        }
        meses = b_map.get(bimestre, ('01', '02'))
        where += f" AND strftime('%m', {alias}.data_inicio) IN (?, ?)"
        params.extend(meses)
    elif trimestre:
        t_map = {
            1: ('01', '02', '03'),
            2: ('04', '05', '06'),
            3: ('07', '08', '09'),
            4: ('10', '11', '12'),
        }
        meses = t_map.get(trimestre, ('01', '02', '03'))
        where += f" AND strftime('%m', {alias}.data_inicio) IN (?, ?, ?)"
        params.extend(meses)
    elif semestre:
        s_map = {
            1: ('01', '02', '03', '04', '05', '06'),
            2: ('07', '08', '09', '10', '11', '12'),
        }
        meses = s_map.get(semestre, ('01', '02', '03', '04', '05', '06'))
        placeholders = ', '.join(['?'] * len(meses))
        where += f" AND strftime('%m', {alias}.data_inicio) IN ({placeholders})"
        params.extend(meses)

    if data_de:
        where += f" AND {alias}.data_inicio >= ?"
        params.append(data_de)

    if data_ate:
        where += f" AND {alias}.data_termino <= ?"
        params.append(data_ate)

    return where, params


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    trimestre: Optional[int] = None,
    semestre: Optional[int] = None,
    bimestre: Optional[int] = None,
    cargo: Optional[str] = None,
    unidade_pb: Optional[str] = None,
    setor: Optional[str] = None,
    meio_transporte: Optional[str] = None,
    data_de: Optional[str] = None,
    data_ate: Optional[str] = None,
    status: Optional[str] = None,
    tipo: Optional[str] = None,
    solicitante: Optional[str] = None,
    destino: Optional[str] = None,
    modalidade: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    today = date.today().isoformat()
    alerts: List[AlertItem] = []

    f_where, f_params = _build_missao_filter(
        ano=ano, mes=mes, trimestre=trimestre, semestre=semestre, bimestre=bimestre,
        cargo=cargo, unidade_pb=unidade_pb, setor=setor, meio_transporte=meio_transporte,
        data_de=data_de, data_ate=data_ate, status=status, tipo=tipo,
        solicitante=solicitante, destino=destino, modalidade=modalidade, alias="m"
    )

    with get_db() as conn:
        # Total de missões
        tot_missoes = conn.execute(
            f"SELECT COUNT(*) as cnt FROM missoes m {f_where} AND m.status_atual != 'CANCELADA'",
            f_params
        ).fetchone()["cnt"]

        # Missões em andamento
        em_andamento = conn.execute(
            f"SELECT COUNT(*) as cnt FROM missoes m {f_where} AND m.status_atual = 'EM_ANDAMENTO'",
            f_params
        ).fetchone()["cnt"]

        # Missões em planejamento / tramitação
        planejamento = conn.execute(
            f"""
            SELECT COUNT(*) as cnt FROM missoes m
            {f_where} AND m.status_atual IN (
                'RASCUNHO', 'SOLICITADA', 'EM_ANALISE', 'APROVADA',
                'OM_EMITIDA', 'OM EMITIDA', 'PCDP_TRAMITADA', 'PCDP CADASTRADA',
                'INDICADO', 'PENDENTE DE ALOCAÇÃO', 'SAT PENDENTE', 'SAT ATENDIDA'
            )
            """,
            f_params
        ).fetchone()["cnt"]

        # Concluídas
        concluidas = conn.execute(
            f"SELECT COUNT(*) as cnt FROM missoes m {f_where} AND m.status_atual IN ('CONCLUIDA', 'CONCLUIDO', 'Concluído')",
            f_params
        ).fetchone()["cnt"]

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

        # Custos financeiros gerais (com filtro opcional de cargo)
        custo_join = ""
        custo_extra_where = ""
        custo_params = list(f_params)
        if cargo:
            custo_join = " JOIN servidores s_crg ON p.servidor_matricula = s_crg.matricula"
            custo_extra_where = " AND s_crg.cargo_sigla = ?"
            custo_params.append(cargo.upper())

        custos = conn.execute(
            f"""
            SELECT 
                COALESCE(SUM(p.valor_total_diarias), 0.0) as tot_diarias,
                COALESCE(SUM(p.valor_passagem_aerea), 0.0) as tot_passagens,
                COALESCE(SUM(p.custo_total_servidor), 0.0) as tot_geral
            FROM missoes_participantes p
            JOIN missoes m ON p.missao_id = m.id
            {custo_join}
            {f_where} {custo_extra_where} AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
            """,
            custo_params
        ).fetchone()

        # TOTAL DE DIÁRIAS JÁ PAGAS PARA SR/PB, DPF/CGE/PB e DPF/PAT/PB
        diarias_sr = conn.execute(
            f"""
            SELECT COALESCE(SUM(p.valor_total_diarias), 0.0) as tot
            FROM missoes_participantes p
            JOIN missoes m ON p.missao_id = m.id
            {custo_join}
            {f_where} {custo_extra_where}
              AND (m.unidade_destino = 'SR/PF/PB' OR m.unidade_solicitante = 'SR/PF/PB')
              AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
            """,
            custo_params
        ).fetchone()["tot"]

        diarias_cge = conn.execute(
            f"""
            SELECT COALESCE(SUM(p.valor_total_diarias), 0.0) as tot
            FROM missoes_participantes p
            JOIN missoes m ON p.missao_id = m.id
            {custo_join}
            {f_where} {custo_extra_where}
              AND (m.unidade_destino LIKE '%CGE%' OR m.unidade_solicitante LIKE '%CGE%')
              AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
            """,
            custo_params
        ).fetchone()["tot"]

        diarias_pat = conn.execute(
            f"""
            SELECT COALESCE(SUM(p.valor_total_diarias), 0.0) as tot
            FROM missoes_participantes p
            JOIN missoes m ON p.missao_id = m.id
            {custo_join}
            {f_where} {custo_extra_where}
              AND (m.unidade_destino LIKE '%PAT%' OR m.unidade_solicitante LIKE '%PAT%')
              AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
            """,
            custo_params
        ).fetchone()["tot"]

        # TOTAL GASTO COM PASSAGENS AÉREAS (todas as unidades da SR com PAT e CGE inclusive)
        passagens_pb = conn.execute(
            f"""
            SELECT COALESCE(SUM(p.valor_passagem_aerea), 0.0) as tot
            FROM missoes_participantes p
            JOIN missoes m ON p.missao_id = m.id
            {custo_join}
            {f_where} {custo_extra_where}
              AND (
                  m.unidade_destino LIKE '%PB%' OR m.unidade_solicitante LIKE '%PB%'
                  OR m.unidade_destino IN ('SR/PF/PB', 'CGE/PF/PB', 'DPF/CGE/PB', 'PAT/PF/PB', 'DPF/PAT/PB')
              )
              AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
            """,
            custo_params
        ).fetchone()["tot"]

        # Constrói filtro para os 4 cards de status sem filtrar pelo próprio status selecionado,
        # para que o usuário veja a contagem de servidores nas 4 etapas dentro do escopo dos outros filtros (ano, mês, setor, etc.)
        f_where_st, f_params_st = _build_missao_filter(
            ano=ano, mes=mes, trimestre=trimestre, semestre=semestre, bimestre=bimestre,
            cargo=cargo, unidade_pb=unidade_pb, setor=setor, meio_transporte=meio_transporte,
            data_de=data_de, data_ate=data_ate, status=None, tipo=tipo,
            solicitante=solicitante, destino=destino, modalidade=modalidade, alias="m"
        )
        st_join = custo_join
        st_extra = custo_extra_where
        st_params = list(f_params_st)
        if cargo:
            st_params.append(cargo.upper())

        # QUANTIDADE DE SERVIDORES POR STATUS DE FLUXO (filtrados pelo contexto ativo)
        # 1. QTOS SERVIDORES NO STATUS CADASTRAR SCDP
        scdp_srv = conn.execute(
            f"""
            SELECT COUNT(DISTINCT COALESCE(p.servidor_matricula, m.missionario_matricula)) as cnt
            FROM missoes m
            LEFT JOIN missoes_participantes p ON m.id = p.missao_id
            {st_join}
            {f_where_st} {st_extra}
              AND m.status_atual IN ('PCDP CADASTRADA', 'PCDP_CADASTRADA', 'PCDP_TRAMITADA', 'OM_EMITIDA', 'OM EMITIDA')
            """,
            st_params
        ).fetchone()["cnt"]

        # 2. QTOS SERVIDORES NO STATUS PRESTAÇÃO CONTAS PENDENTE
        pc_srv = conn.execute(
            f"""
            SELECT COUNT(DISTINCT COALESCE(p.servidor_matricula, m.missionario_matricula)) as cnt
            FROM missoes m
            LEFT JOIN missoes_participantes p ON m.id = p.missao_id
            {st_join}
            {f_where_st} {st_extra}
              AND m.status_atual IN ('PRESTACAO_CONTAS', 'PCDP PRESTAR CONTAS', 'PCDP_PRESTAR_CONTAS')
            """,
            st_params
        ).fetchone()["cnt"]

        # 3. QTOS SERVIDORES NO STATUS OM PENDENTE
        om_srv = conn.execute(
            f"""
            SELECT COUNT(DISTINCT COALESCE(p.servidor_matricula, m.missionario_matricula)) as cnt
            FROM missoes m
            LEFT JOIN missoes_participantes p ON m.id = p.missao_id
            {st_join}
            {f_where_st} {st_extra}
              AND m.status_atual IN ('APROVADA', 'SAT ATENDIDA', 'SAT_ATENDIDA', 'SAT PENDENTE', 'INDICADO', 'PENDENTE DE ALOCAÇÃO')
            """,
            st_params
        ).fetchone()["cnt"]

        # 4. QUANTOS SERVIDORES NO STATUS MISSÃO CONCLUÍDA
        conc_srv = conn.execute(
            f"""
            SELECT COUNT(DISTINCT COALESCE(p.servidor_matricula, m.missionario_matricula)) as cnt
            FROM missoes m
            LEFT JOIN missoes_participantes p ON m.id = p.missao_id
            {st_join}
            {f_where_st} {st_extra}
              AND m.status_atual IN ('CONCLUIDA', 'CONCLUIDO', 'Concluído')
            """,
            st_params
        ).fetchone()["cnt"]

        # Diária padrão atual
        cfg_diaria = conn.execute("SELECT valor FROM configuracoes WHERE chave = 'valor_diaria_padrao'").fetchone()
        diaria_padrao = float(cfg_diaria["valor"]) if cfg_diaria else 425.00

        # Alertas do Sistema:
        # 1. Missões a iniciar em menos de 5 dias sem PCDP
        cfg_dias_pcdp = conn.execute("SELECT valor FROM configuracoes WHERE chave = 'alerta_pcdp_dias'").fetchone()
        alerta_dias_pcdp = int(cfg_dias_pcdp["valor"]) if cfg_dias_pcdp else 5
        cinco_dias_frente = (date.today() + timedelta(days=alerta_dias_pcdp)).isoformat()
        sem_pcdp = conn.execute(
            """
            SELECT codigo_missao, titulo, data_inicio, status_atual
            FROM missoes
            WHERE (numero_pcdp IS NULL OR numero_pcdp = '')
              AND status_atual IN ('APROVADA', 'OM_EMITIDA', 'OM EMITIDA', 'SAT ATENDIDA')
              AND data_inicio <= ?
            """,
            (cinco_dias_frente,)
        ).fetchall()

        for sp in sem_pcdp:
            alerts.append(AlertItem(
                tipo="PERIGO",
                titulo="Missão Próxima sem PCDP Cadastrada",
                mensagem=f"A missão '{sp['titulo']}' inicia em {sp['data_inicio']} e ainda não possui número de PCDP lançado no SCDP.",
                missao_codigo=sp["codigo_missao"],
                codigo_missao=sp["codigo_missao"]
            ))

        # 2. Missões finalizadas com prestação de contas pendente (> 5 dias após retorno)
        cfg_dias_pc = conn.execute("SELECT valor FROM configuracoes WHERE chave = 'alerta_prestacao_contas_dias'").fetchone()
        alerta_dias_pc = int(cfg_dias_pc["valor"]) if cfg_dias_pc else 5
        cinco_dias_atras = (date.today() - timedelta(days=alerta_dias_pc)).isoformat()
        pendentes_pc = conn.execute(
            """
            SELECT codigo_missao, titulo, data_termino, status_atual
            FROM missoes
            WHERE data_termino <= ?
              AND status_atual IN ('EM_ANDAMENTO', 'PRESTACAO_CONTAS', 'PCDP PRESTAR CONTAS')
            """,
            (cinco_dias_atras,)
        ).fetchall()

        for ppc in pendentes_pc:
            alerts.append(AlertItem(
                tipo="ALERTA",
                titulo="Prazo de Prestação de Contas Excedido",
                mensagem=f"A missão '{ppc['titulo']}' encerrou em {ppc['data_termino']} e requer homologação de bilhetes e relatório de conclusão.",
                missao_codigo=ppc["codigo_missao"],
                codigo_missao=ppc["codigo_missao"]
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

        # 4. ALERTA DE PASSAGEM AÉREA (17 DIAS PARA INÍCIO OU TÉRMINO DA MISSÃO COM NOMES DOS SERVIDORES)
        cfg_dias_aereo = conn.execute("SELECT valor FROM configuracoes WHERE chave = 'alerta_passagem_aerea_dias'").fetchone()
        alerta_aereo_dias = int(cfg_dias_aereo["valor"]) if cfg_dias_aereo else 17
        data_limite_aereo = (date.today() + timedelta(days=alerta_aereo_dias)).isoformat()
        hoje_str = date.today().isoformat()

        aereos_criticos = conn.execute(
            """
            SELECT m.codigo_missao, m.titulo, m.data_inicio, m.data_termino, m.status_atual,
                   COALESCE(s.nome_completo, sm.nome_completo, 'Policial Designado') as servidor_nome,
                   COALESCE(s.matricula, sm.matricula, m.missionario_matricula, '-') as servidor_mat,
                   COALESCE(p.meio_transporte, m.meio_transporte) as meio_transporte,
                   p.localizador_aereo, p.numero_eticket
            FROM missoes m
            LEFT JOIN missoes_participantes p ON m.id = p.missao_id
            LEFT JOIN servidores s ON p.servidor_matricula = s.matricula
            LEFT JOIN servidores sm ON m.missionario_matricula = sm.matricula
            WHERE m.status_atual NOT IN ('CANCELADA', 'REJEITADA', 'CONCLUIDA', 'CONCLUIDO')
              AND (m.meio_transporte = 'AEREO' OR p.meio_transporte = 'AEREO' OR (p.valor_passagem_aerea IS NOT NULL AND p.valor_passagem_aerea > 0) OR m.custo_estimado_passagens > 0)
              AND (
                  (m.data_inicio >= ? AND m.data_inicio <= ?)
                  OR
                  (m.data_termino >= ? AND m.data_termino <= ?)
              )
            ORDER BY m.data_inicio ASC, servidor_nome ASC
            """,
            (hoje_str, data_limite_aereo, hoje_str, data_limite_aereo)
        ).fetchall()

        missoes_aereas = defaultdict(list)
        for ac in aereos_criticos:
            missoes_aereas[ac["codigo_missao"]].append(ac)

        for cod, srv_list in missoes_aereas.items():
            m_info = srv_list[0]
            nomes = [f"{s['servidor_nome']} (Matrícula {s['servidor_mat']})" for s in srv_list]
            alerts.append(AlertItem(
                tipo="ALERTA",
                titulo=f"Emissão de Bilhete Aéreo (Prazo Crítico: {alerta_aereo_dias} dias)",
                mensagem=f"Servidor(es) com voo programado: {', '.join(nomes)}. Missão '{m_info['titulo']}' (Início: {m_info['data_inicio']}, Término: {m_info['data_termino']}). Verificar bilhete e localizador.",
                missao_codigo=cod,
                codigo_missao=cod,
                servidores_nomes=nomes
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
        alertas=alerts,
        diarias_sr_pb=round(diarias_sr, 2),
        diarias_cge_pb=round(diarias_cge, 2),
        diarias_pat_pb=round(diarias_pat, 2),
        passagens_total_pb=round(passagens_pb, 2),
        servidores_cadastrar_scdp=scdp_srv,
        servidores_prestacao_contas_pendente=pc_srv,
        servidores_om_pendente=om_srv,
        servidores_missao_concluida=conc_srv,
        servidores_status_scdp=scdp_srv,
        servidores_status_prestacao_contas=pc_srv,
        servidores_status_om_pendente=om_srv,
        servidores_status_concluida=conc_srv
    )

@router.get("/charts")
def get_dashboard_charts(
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    trimestre: Optional[int] = None,
    semestre: Optional[int] = None,
    bimestre: Optional[int] = None,
    cargo: Optional[str] = None,
    unidade_pb: Optional[str] = None,
    setor: Optional[str] = None,
    meio_transporte: Optional[str] = None,
    data_de: Optional[str] = None,
    data_ate: Optional[str] = None,
    status: Optional[str] = None,
    tipo: Optional[str] = None,
    solicitante: Optional[str] = None,
    destino: Optional[str] = None,
    modalidade: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
) -> Dict[str, Any]:
    f_where, f_params = _build_missao_filter(
        ano=ano, mes=mes, trimestre=trimestre, semestre=semestre, bimestre=bimestre,
        cargo=cargo, unidade_pb=unidade_pb, setor=setor, meio_transporte=meio_transporte,
        data_de=data_de, data_ate=data_ate, status=status, tipo=tipo,
        solicitante=solicitante, destino=destino, modalidade=modalidade, alias="m"
    )

    with get_db() as conn:
        # Por tipo de missão
        por_tipo = conn.execute(
            f"""
            SELECT m.tipo_missao, COUNT(*) as qtd
            FROM missoes m
            {f_where} AND m.status_atual != 'CANCELADA'
            GROUP BY m.tipo_missao
            """,
            f_params
        ).fetchall()

        # Por cargo (quantidade de servidores)
        por_cargo = conn.execute(
            """
            SELECT cargo_sigla, COUNT(*) as qtd
            FROM servidores
            WHERE ativo = 1
            GROUP BY cargo_sigla
            ORDER BY qtd DESC
            """
        ).fetchall()

        # Diárias por cargo (gasto acumulado)
        diarias_por_cargo = conn.execute(
            f"""
            SELECT s.cargo_sigla as cargo,
                   COALESCE(SUM(p.valor_total_diarias), 0.0) as total_diarias,
                   COALESCE(SUM(p.valor_passagem_aerea), 0.0) as total_passagens,
                   COALESCE(SUM(p.custo_total_servidor), 0.0) as total_geral
            FROM missoes_participantes p
            JOIN missoes m ON p.missao_id = m.id
            JOIN servidores s ON p.servidor_matricula = s.matricula
            {f_where} AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
            GROUP BY s.cargo_sigla
            ORDER BY total_diarias DESC
            """,
            f_params
        ).fetchall()

        # Por status de missão
        por_status = conn.execute(
            f"""
            SELECT m.status_atual, COUNT(*) as qtd
            FROM missoes m
            {f_where}
            GROUP BY m.status_atual
            """,
            f_params
        ).fetchall()

        # Custos por mês
        custos_mes = conn.execute(
            f"""
            SELECT 
                strftime('%Y-%m', m.data_inicio) as mes_ano,
                strftime('%m', m.data_inicio) as mes,
                COALESCE(SUM(p.valor_total_diarias), 0.0) as diarias,
                COALESCE(SUM(p.valor_passagem_aerea), 0.0) as passagens,
                COALESCE(SUM(p.custo_total_servidor), 0.0) as total
            FROM missoes m
            LEFT JOIN missoes_participantes p ON m.id = p.missao_id
            {f_where} AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
            GROUP BY strftime('%Y-%m', m.data_inicio)
            ORDER BY mes_ano ASC
            """,
            f_params
        ).fetchall()

        # Gastos com passagens aéreas por setor da SR/PF/PB (DRPJ, DMA, NAD, NTI, DREX, SIP, SELOG, etc.)
        passagens_setores = conn.execute(
            f"""
            SELECT COALESCE(m.setor_destino, 'Gabinete/Geral') as setor,
                   COALESCE(SUM(p.valor_passagem_aerea), 0.0) as passagens,
                   COALESCE(SUM(p.valor_total_diarias), 0.0) as diarias,
                   COALESCE(SUM(p.custo_total_servidor), 0.0) as total
            FROM missoes m
            LEFT JOIN missoes_participantes p ON m.id = p.missao_id
            {f_where} AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
              AND m.setor_destino IS NOT NULL
            GROUP BY m.setor_destino
            ORDER BY passagens DESC, total DESC
            """,
            f_params
        ).fetchall()

        # Gastos de passagens por Unidade da Paraíba (SR/PF/PB, DPF/CGE/PB, DPF/PAT/PB)
        passagens_unidades = conn.execute(
            f"""
            SELECT m.unidade_destino as unidade,
                   COALESCE(SUM(p.valor_passagem_aerea), 0.0) as passagens,
                   COALESCE(SUM(p.valor_total_diarias), 0.0) as diarias,
                   COALESCE(SUM(p.custo_total_servidor), 0.0) as total
            FROM missoes m
            LEFT JOIN missoes_participantes p ON m.id = p.missao_id
            {f_where} AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
              AND m.unidade_destino IS NOT NULL
            GROUP BY m.unidade_destino
            ORDER BY passagens DESC
            """,
            f_params
        ).fetchall()

        # Top unidades demandantes
        top_unid = conn.execute(
            f"""
            SELECT m.unidade_destino as unidade, COUNT(*) as total
            FROM missoes m
            {f_where} AND m.status_atual != 'CANCELADA' AND m.unidade_destino IS NOT NULL
            GROUP BY m.unidade_destino
            ORDER BY total DESC
            LIMIT 5
            """,
            f_params
        ).fetchall()

    por_tipo_list = [dict(r) for r in por_tipo]
    por_cargo_list = [dict(r) for r in por_cargo]
    por_status_list = [dict(r) for r in por_status]
    custos_mes_list = [
        {
            "mes_ano": r["mes_ano"],
            "mes": r["mes"],
            "diarias": round(float(r["diarias"]), 2),
            "total_diarias": round(float(r["diarias"]), 2),
            "passagens": round(float(r["passagens"]), 2),
            "total_passagens": round(float(r["passagens"]), 2),
            "total": round(float(r["total"]), 2),
            "total_custo": round(float(r["total"]), 2)
        }
        for r in custos_mes
    ]

    diarias_cargo_list = [
        {
            "cargo": r["cargo"],
            "total_diarias": round(float(r["total_diarias"]), 2),
            "total_passagens": round(float(r["total_passagens"]), 2),
            "total_geral": round(float(r["total_geral"]), 2)
        }
        for r in diarias_por_cargo
    ]

    passagens_setores_list = [
        {
            "setor": r["setor"],
            "passagens": round(float(r["passagens"]), 2),
            "total_passagens": round(float(r["passagens"]), 2),
            "diarias": round(float(r["diarias"]), 2),
            "total_diarias": round(float(r["diarias"]), 2),
            "total": round(float(r["total"]), 2),
            "total_geral": round(float(r["total"]), 2)
        }
        for r in passagens_setores
    ]

    passagens_unidades_list = [
        {
            "unidade": r["unidade"],
            "passagens": round(float(r["passagens"]), 2),
            "total_passagens": round(float(r["passagens"]), 2),
            "diarias": round(float(r["diarias"]), 2),
            "total_diarias": round(float(r["diarias"]), 2),
            "total": round(float(r["total"]), 2),
            "total_geral": round(float(r["total"]), 2)
        }
        for r in passagens_unidades
    ]

    return {
        "por_tipo": por_tipo_list,
        "por_cargo": por_cargo_list,
        "diarias_por_cargo": diarias_cargo_list,
        "por_status": por_status_list,
        "custos_por_mes": custos_mes_list,
        "passagens_por_setor": passagens_setores_list,
        "passagens_por_unidade": passagens_unidades_list,
        "status_counts": [{"status": r["status_atual"], "total": r["qtd"]} for r in por_status],
        "tipo_counts": [{"tipo": r["tipo_missao"], "total": r["qtd"]} for r in por_tipo],
        "top_unidades_demandantes": [dict(r) for r in top_unid]
    }
