import uuid
from datetime import date
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status, Request
from app.schemas import (
    MissaoCreate, MissaoUpdate, MissaoOut,
    ParticipanteCreate, ParticipanteUpdate, ParticipanteOut,
    StatusUpdate, ValorDiariaUpdate,
    OrgaoUnidadeCreate, OrgaoUnidadeUpdate, OrgaoUnidadeOut,
    ValorDiariaItem, ValorDiariaItemUpdate,
    SetorDestinoOut, SetorDestinoCreate
)
from app.auth import get_current_user, require_admin, require_write_permission, require_approval_permission, require_admin_only
from app.database import get_db
from app.calculator import compute_participant_financials, parse_date
from app.audit import log_audit

from app.status_utils import (
    OFFICIAL_STATUSES,
    CONCLUDED_STATUS_VALUES,
    normalize_canonical_status,
    is_approval_restricted_status,
    build_status_filter_clause,
)

router = APIRouter(prefix="/api/missoes", tags=["Missões Institucionais"])


def _normalize_meio_transporte(raw: Optional[str]) -> str:
    val = (raw or "").strip().upper()
    if val in ("", "NAO_DEFINIDO", "NAO DEFINIDO", "NÃO DEFINIDO", "NÃO_DEFINIDO"):
        return "NAO_DEFINIDO"
    if val in ("AEREO", "AÉREO"):
        return "AEREO"
    if val in ("PROPRIO", "PRÓPRIO"):
        return "PROPRIO"
    if val == "TERRESTRE":
        return "TERRESTRE"
    return val

def _format_participante(row: dict) -> ParticipanteOut:
    return ParticipanteOut(
        id=row["id"],
        missao_id=row["missao_id"],
        servidor_matricula=row["servidor_matricula"],
        servidor_nome=row.get("servidor_nome"),
        servidor_nome_guerra=row.get("servidor_nome_guerra"),
        servidor_cargo=row.get("servidor_cargo"),
        servidor_lotacao=row.get("servidor_lotacao"),
        papel=row["papel"],
        meio_transporte=row["meio_transporte"],
        data_apresentacao=str(row["data_apresentacao"]),
        data_retorno=str(row["data_retorno"]),
        dias_participacao=int(row["dias_participacao"]),
        is_missao_sede=bool(row["is_missao_sede"]),
        qtd_diarias=float(row["qtd_diarias"]),
        valor_diaria_unitaria=float(row["valor_diaria_unitaria"]),
        valor_total_diarias=float(row["valor_total_diarias"]),
        valor_passagem_aerea=float(row["valor_passagem_aerea"]),
        outros_custos=float(row["outros_custos"]),
        custo_total_servidor=float(row["custo_total_servidor"]),
        localizador_aereo=row.get("localizador_aereo"),
        numero_eticket=row.get("numero_eticket"),
        observacoes=row.get("observacoes"),
        created_at=str(row.get("created_at")),
        updated_at=str(row.get("updated_at"))
    )

def _get_missao_full(missao_id_or_code: str, conn) -> Optional[dict]:
    m = conn.execute(
        """
        SELECT m.*,
               s.nome_completo as responsavel_nome,
               s.nome_guerra as responsavel_nome_guerra,
               sm.nome_completo as missionario_nome,
               sm.nome_guerra as missionario_nome_guerra
        FROM missoes m
        LEFT JOIN servidores s ON m.responsavel_matricula = s.matricula
        LEFT JOIN servidores sm ON m.missionario_matricula = sm.matricula
        WHERE m.id = ? OR m.codigo_missao = ?
        """,
        (missao_id_or_code, missao_id_or_code)
    ).fetchone()
    if not m:
        return None

    # Participantes com dados do servidor
    p_rows = conn.execute(
        """
        SELECT p.*, s.nome_completo as servidor_nome, s.nome_guerra as servidor_nome_guerra, s.cargo_sigla as servidor_cargo, s.unidade_sigla as servidor_lotacao
        FROM missoes_participantes p
        JOIN servidores s ON p.servidor_matricula = s.matricula
        WHERE p.missao_id = ?
        ORDER BY p.data_apresentacao ASC, s.nome_completo ASC
        """,
        (m["id"],)
    ).fetchall()

    participantes = [_format_participante(dict(p)) for p in p_rows]

    tot_diarias = sum(p.valor_total_diarias for p in participantes)
    tot_passagens = sum(p.valor_passagem_aerea for p in participantes)
    tot_geral = sum(p.custo_total_servidor for p in participantes)

    res = dict(m)
    res["total_participantes"] = len(participantes)
    res["total_custo_diarias"] = round(tot_diarias, 2)
    res["total_custo_passagens"] = round(tot_passagens, 2)
    res["total_custo_geral"] = round(tot_geral, 2)
    res["participantes"] = participantes
    return res

@router.get("", response_model=List[MissaoOut])
def list_missoes(
    q: Optional[str] = None,
    status: Optional[str] = None,
    tipo: Optional[str] = None,
    solicitante: Optional[str] = None,
    destino: Optional[str] = None,
    setor: Optional[str] = None,
    unidade_pb: Optional[str] = None,
    meio_transporte: Optional[str] = None,
    modalidade: Optional[str] = None,
    missionario: Optional[str] = None,
    responsavel: Optional[str] = None,
    ano: Optional[int] = None,
    mes: Optional[int] = None,
    data_de: Optional[str] = None,
    data_ate: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = """
        SELECT m.*,
               s.nome_completo as responsavel_nome,
               s.nome_guerra as responsavel_nome_guerra,
               sm.nome_completo as missionario_nome,
               sm.nome_guerra as missionario_nome_guerra,
               COUNT(p.id) as total_participantes,
               COALESCE(SUM(p.valor_total_diarias), 0.0) as total_custo_diarias,
               COALESCE(SUM(p.valor_passagem_aerea), 0.0) as total_custo_passagens,
               COALESCE(SUM(p.custo_total_servidor), 0.0) as total_custo_geral
        FROM missoes m
        LEFT JOIN servidores s ON m.responsavel_matricula = s.matricula
        LEFT JOIN servidores sm ON m.missionario_matricula = sm.matricula
        LEFT JOIN missoes_participantes p ON m.id = p.missao_id
        WHERE 1=1
    """
    params = []

    if q:
        query += """ AND (
            m.codigo_missao LIKE ? OR m.titulo LIKE ? OR m.localidade_descricao LIKE ?
            OR m.numero_om LIKE ? OR m.numero_pcdp LIKE ?
            OR s.nome_completo LIKE ? OR s.nome_guerra LIKE ?
            OR sm.nome_completo LIKE ? OR sm.nome_guerra LIKE ?
            OR EXISTS (
                SELECT 1 FROM missoes_participantes mp
                JOIN servidores sp ON mp.servidor_matricula = sp.matricula
                WHERE mp.missao_id = m.id
                  AND (sp.nome_completo LIKE ? OR sp.nome_guerra LIKE ? OR sp.matricula LIKE ?)
            )
        )"""
        term = f"%{q.strip()}%"
        params.extend([term] * 12)

    if status:
        st_sql, st_params = build_status_filter_clause(status, "m.status_atual")
        query += st_sql
        params.extend(st_params)

    if tipo:
        query += " AND m.tipo_missao = ?"
        params.append(tipo)

    if solicitante:
        query += " AND m.unidade_solicitante = ?"
        params.append(solicitante)

    if destino:
        query += " AND m.unidade_destino = ?"
        params.append(destino)

    if setor:
        query += " AND m.setor_destino = ?"
        params.append(setor.strip().upper())

    if meio_transporte:
        query += " AND (m.meio_transporte = ? OR EXISTS (SELECT 1 FROM missoes_participantes mp_tr WHERE mp_tr.missao_id = m.id AND mp_tr.meio_transporte = ?))"
        params.extend([meio_transporte.upper(), meio_transporte.upper()])

    if unidade_pb:
        u_pb = unidade_pb.strip().upper()
        if "CGE" in u_pb:
            query += " AND (m.unidade_solicitante LIKE '%CGE%' OR m.unidade_destino LIKE '%CGE%')"
        elif "PAT" in u_pb:
            query += " AND (m.unidade_solicitante LIKE '%PAT%' OR m.unidade_destino LIKE '%PAT%')"
        elif "SR" in u_pb or "PB" in u_pb:
            query += " AND (m.unidade_solicitante = 'SR/PF/PB' OR m.unidade_destino = 'SR/PF/PB')"
        else:
            query += " AND (m.unidade_solicitante = ? OR m.unidade_destino = ?)"
            params.extend([unidade_pb, unidade_pb])

    if modalidade:
        query += " AND m.modalidade = ?"
        params.append(modalidade.upper())

    if missionario:
        query += " AND (m.missionario_matricula = ? OR EXISTS (SELECT 1 FROM missoes_participantes mp WHERE mp.missao_id = m.id AND mp.servidor_matricula = ?))"
        params.extend([missionario, missionario])

    if responsavel:
        query += " AND m.responsavel_matricula = ?"
        params.append(responsavel)

    if ano:
        query += " AND (strftime('%Y', m.data_inicio) = ? OR strftime('%Y', m.data_termino) = ?)"
        params.extend([str(ano), str(ano)])

    if mes:
        mes_str = f"{mes:02d}"
        query += " AND (strftime('%m', m.data_inicio) = ? OR strftime('%m', m.data_termino) = ?)"
        params.extend([mes_str, mes_str])

    if data_de:
        query += " AND m.data_inicio >= ?"
        params.append(data_de)

    if data_ate:
        query += " AND m.data_termino <= ?"
        params.append(data_ate)

    query += " GROUP BY m.id ORDER BY m.data_inicio DESC, m.codigo_missao DESC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    return [
        MissaoOut(
            id=r["id"],
            codigo_missao=r["codigo_missao"],
            titulo=r["titulo"],
            justificativa=r["justificativa"],
            tipo_missao=r["tipo_missao"],
            unidade_solicitante=r["unidade_solicitante"],
            unidade_destino=r["unidade_destino"],
            setor_destino=r["setor_destino"],
            localidade_descricao=r["localidade_descricao"],
            data_inicio=str(r["data_inicio"]),
            data_termino=str(r["data_termino"]),
            total_dias=int(r["total_dias"]),
            responsavel_matricula=r["responsavel_matricula"],
            responsavel_nome=r["responsavel_nome"],
            responsavel_nome_guerra=r["responsavel_nome_guerra"],
            missionario_matricula=r["missionario_matricula"],
            missionario_nome=r["missionario_nome"],
            missionario_nome_guerra=r["missionario_nome_guerra"],
            modalidade=r["modalidade"] or "INDIVIDUAL",
            status_atual=r["status_atual"],
            meio_transporte=r["meio_transporte"] or "NAO_DEFINIDO",
            custo_estimado_passagens=float(r["custo_estimado_passagens"] or 0.0),
            numero_sat=r["numero_sat"],
            numero_om=r["numero_om"],
            numero_pcdp=r["numero_pcdp"],
            processo_sei=r["processo_sei"],
            valor_diaria_padrao=float(r["valor_diaria_padrao"]),
            observacoes=r["observacoes"],
            total_participantes=int(r["total_participantes"]),
            total_custo_diarias=round(float(r["total_custo_diarias"]), 2),
            total_custo_passagens=round(float(r["total_custo_passagens"]), 2),
            total_custo_geral=round(float(r["total_custo_geral"]), 2),
            participantes=[],
            created_at=str(r["created_at"]),
            updated_at=str(r["updated_at"])
        )
        for r in rows
    ]


@router.get("/{codigo_ou_id}", response_model=MissaoOut)
def get_missao(codigo_ou_id: str, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        m = _get_missao_full(codigo_ou_id, conn)
    if not m:
        raise HTTPException(status_code=404, detail="Missão não encontrada.")
    return MissaoOut(**m)

@router.post("", response_model=MissaoOut, status_code=status.HTTP_201_CREATED)
def create_missao(data: MissaoCreate, request: Request, current_user: dict = Depends(require_write_permission)):
    d_inicio = parse_date(data.data_inicio)
    d_termino = parse_date(data.data_termino)
    if d_termino < d_inicio:
        raise HTTPException(status_code=400, detail="Data de término não pode ser anterior à data de início.")

    total_dias = (d_termino - d_inicio).days + 1
    mid = f"mis-{uuid.uuid4().hex[:12]}"
    modalidade = (data.modalidade or "INDIVIDUAL").upper()
    raw_codigo = (data.codigo_missao or "").strip()
    justificativa_clean = (data.justificativa or "").strip()

    if data.status_atual:
        st_norm = normalize_canonical_status(data.status_atual)
        if not st_norm:
            raise HTTPException(
                status_code=400,
                detail=f"Status '{data.status_atual}' inválido. Valores aceitos: {', '.join(OFFICIAL_STATUSES)}"
            )
        status_inicial = st_norm
    else:
        status_inicial = "Pendente de Alocação"

    if current_user.get("role") == "CADASTRADOR" and is_approval_restricted_status(status_inicial):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Perfil CADASTRADOR não possui permissão para criar missão já com status avançado ou de aprovação."
        )

    resp_mat = data.responsavel_matricula.strip() if (data.responsavel_matricula and data.responsavel_matricula.strip()) else None
    miss_mat = data.missionario_matricula.strip() if (data.missionario_matricula and data.missionario_matricula.strip()) else None
    unidade_solicitante_final = (data.unidade_solicitante or "").strip() or "SR/PF/PB"
    unidade_destino_final = (data.unidade_destino or "").strip() or None
    tipo_missao_final = (data.tipo_missao or "").strip() or "Operacional / Repressão"
    meio_transp = _normalize_meio_transporte(data.meio_transporte)
    custo_passagem = float(data.custo_estimado_passagens or 0.0) if meio_transp == "AEREO" else 0.0
    setor_dest = data.setor_destino.strip().upper() if (data.setor_destino and data.setor_destino.strip()) else None
    fields_set = getattr(data, "model_fields_set", set())

    with get_db() as conn:
        # Gera código interno automático se omitido pela UI
        if raw_codigo:
            codigo_missao_final = raw_codigo
            exist = conn.execute("SELECT id FROM missoes WHERE codigo_missao = ?", (codigo_missao_final,)).fetchone()
            if exist:
                raise HTTPException(status_code=400, detail=f"Já existe missão com o código {codigo_missao_final}.")
        else:
            codigo_missao_final = f"MIS-{d_inicio.year}-{uuid.uuid4().hex[:6].upper()}"
            while conn.execute("SELECT id FROM missoes WHERE codigo_missao = ?", (codigo_missao_final,)).fetchone():
                codigo_missao_final = f"MIS-{d_inicio.year}-{uuid.uuid4().hex[:6].upper()}"

        # Localidade padrão a partir da unidade de destino se omitida
        localidade_final = (data.localidade_descricao or "").strip()
        if not localidade_final and unidade_destino_final:
            u_loc = conn.execute("SELECT municipio, uf FROM orgao_unidades WHERE sigla = ?", (unidade_destino_final,)).fetchone()
            localidade_final = f"{u_loc['municipio']}/{u_loc['uf']}" if u_loc else unidade_destino_final
        if not localidade_final:
            localidade_final = "A definir"

        # Respeita valor_diaria_padrao enviado explicitamente (mesmo se 425.00);
        # auto-ajusta pela unidade apenas quando omitido ou None.
        if "valor_diaria_padrao" in fields_set and data.valor_diaria_padrao is not None:
            valor_diaria = float(data.valor_diaria_padrao)
        else:
            valor_diaria = None
            if unidade_destino_final:
                u_row = conn.execute("SELECT valor_diaria FROM orgao_unidades WHERE sigla = ?", (unidade_destino_final,)).fetchone()
                if u_row and u_row["valor_diaria"] is not None:
                    valor_diaria = float(u_row["valor_diaria"])
            if valor_diaria is None or valor_diaria <= 0:
                cfg = conn.execute("SELECT valor FROM configuracoes WHERE chave = 'valor_diaria_padrao'").fetchone()
                valor_diaria = float(cfg["valor"]) if cfg else 425.00

        # Se modalidade INDIVIDUAL e missionario_matricula informado, validar servidor e conflito
        srv_ind = None
        if modalidade == "INDIVIDUAL" and miss_mat:
            srv_ind = conn.execute(
                "SELECT matricula, nome_completo, unidade_sigla, is_missionario_geral FROM servidores WHERE matricula = ?",
                (miss_mat,)
            ).fetchone()
            if not srv_ind:
                raise HTTPException(status_code=404, detail=f"Servidor missionário com matrícula '{miss_mat}' não encontrado.")

            conflict = conn.execute(
                """
                SELECT m.codigo_missao, m.titulo, p.data_apresentacao, p.data_retorno
                FROM missoes_participantes p
                JOIN missoes m ON p.missao_id = m.id
                WHERE p.servidor_matricula = ?
                  AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
                  AND p.data_apresentacao <= ?
                  AND p.data_retorno >= ?
                """,
                (miss_mat, str(d_termino), str(d_inicio))
            ).fetchone()
            if conflict:
                raise HTTPException(
                    status_code=400,
                    detail=f"Conflito de agenda: Servidor já possui missão ativa '{conflict['codigo_missao']}' de {conflict['data_apresentacao']} a {conflict['data_retorno']}."
                )

        titulo_final = (data.titulo or "").strip()
        if not titulo_final:
            if modalidade == "INDIVIDUAL" and srv_ind:
                titulo_final = f"Recrutamento - {srv_ind['nome_completo']} ({localidade_final})"
            else:
                titulo_final = f"Recrutamento {tipo_missao_final} - {localidade_final}"

        conn.execute(
            """
            INSERT INTO missoes (
                id, codigo_missao, titulo, justificativa, tipo_missao, unidade_solicitante,
                unidade_destino, setor_destino, localidade_descricao, data_inicio, data_termino, total_dias,
                responsavel_matricula, missionario_matricula, modalidade, status_atual,
                meio_transporte, custo_estimado_passagens, numero_sat, numero_om, numero_pcdp,
                processo_sei, valor_diaria_padrao, observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                mid, codigo_missao_final, titulo_final, justificativa_clean,
                tipo_missao_final, unidade_solicitante_final, unidade_destino_final, setor_dest,
                localidade_final, str(d_inicio), str(d_termino), total_dias,
                resp_mat, miss_mat,
                modalidade, status_inicial,
                meio_transp, custo_passagem,
                data.numero_sat, data.numero_om, data.numero_pcdp, data.processo_sei,
                valor_diaria, data.observacoes
            )
        )

        # Se missão for individual e tiver missionário definido, criar participante atômico
        if modalidade == "INDIVIDUAL" and miss_mat and srv_ind:
            is_sede = 1 if ((unidade_destino_final and srv_ind["unidade_sigla"] == unidade_destino_final) or srv_ind["is_missionario_geral"] == 0) else 0
            fin = compute_participant_financials(
                data_apresentacao=str(d_inicio),
                data_retorno=str(d_termino),
                is_sede=bool(is_sede),
                valor_diaria_unitaria=valor_diaria,
                valor_passagem_aerea=custo_passagem
            )
            part_id = f"part-{uuid.uuid4().hex[:10]}"
            conn.execute(
                """
                INSERT INTO missoes_participantes (
                    id, missao_id, servidor_matricula, papel, meio_transporte, data_apresentacao,
                    data_retorno, dias_participacao, is_missao_sede, qtd_diarias, valor_diaria_unitaria,
                    valor_total_diarias, valor_passagem_aerea, outros_custos, custo_total_servidor,
                    observacoes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    part_id, mid, miss_mat, "Missionário Individual", meio_transp,
                    str(d_inicio), str(d_termino), fin["dias_participacao"], is_sede,
                    fin["qtd_diarias"], fin["valor_diaria_unitaria"], fin["valor_total_diarias"],
                    fin["valor_passagem_aerea"], 0.0, fin["custo_total_servidor"],
                    "Participante individual vinculado automaticamente."
                )
            )
        elif modalidade == "EQUIPE" and (data.servidores_matriculas or data.servidores_equipe_matriculas):
            # Inserir múltiplos servidores na missão de equipe
            equipe_mats = data.servidores_matriculas or data.servidores_equipe_matriculas
            for idx, mat in enumerate(equipe_mats):
                mat_clean = mat.strip()
                srv = conn.execute("SELECT matricula, unidade_sigla, is_missionario_geral FROM servidores WHERE matricula = ?", (mat_clean,)).fetchone()
                if not srv:
                    continue
                is_sede = 1 if ((unidade_destino_final and srv["unidade_sigla"] == unidade_destino_final) or srv["is_missionario_geral"] == 0) else 0
                fin = compute_participant_financials(
                    data_apresentacao=str(d_inicio),
                    data_retorno=str(d_termino),
                    is_sede=bool(is_sede),
                    valor_diaria_unitaria=valor_diaria,
                    valor_passagem_aerea=custo_passagem
                )
                pid = f"part-{uuid.uuid4().hex[:10]}"
                conn.execute(
                    """
                    INSERT INTO missoes_participantes (
                        id, missao_id, servidor_matricula, papel, meio_transporte, data_apresentacao,
                        data_retorno, dias_participacao, is_missao_sede, qtd_diarias, valor_diaria_unitaria,
                        valor_total_diarias, valor_passagem_aerea, outros_custos, custo_total_servidor,
                        observacoes
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(missao_id, servidor_matricula, data_apresentacao) DO NOTHING
                    """,
                    (
                        pid, mid, mat_clean, "Operador Tático" if idx > 0 else "Coordenador de Missão",
                        meio_transp, str(d_inicio), str(d_termino), fin["dias_participacao"], is_sede,
                        fin["qtd_diarias"], fin["valor_diaria_unitaria"], fin["valor_total_diarias"],
                        fin["valor_passagem_aerea"], 0.0, fin["custo_total_servidor"],
                        "Participante de equipe vinculado no cadastro inicial."
                    )
                )

        res = _get_missao_full(mid, conn)

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="CREATE",
        entidade_tabela="missoes",
        registro_id=mid,
        detalhes={"codigo_missao": codigo_missao_final, "titulo": titulo_final, "modalidade": modalidade, "valor_diaria": valor_diaria}
    )

    return MissaoOut(**res)


@router.put("/{codigo_ou_id}", response_model=MissaoOut)
def update_missao(codigo_ou_id: str, data: MissaoUpdate, request: Request, current_user: dict = Depends(require_write_permission)):
    with get_db() as conn:
        m = conn.execute("SELECT * FROM missoes WHERE id = ? OR codigo_missao = ?", (codigo_ou_id, codigo_ou_id)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Missão não encontrada.")

        updates = []
        params = []

        d_inicio = parse_date(data.data_inicio) if data.data_inicio else parse_date(m["data_inicio"])
        d_termino = parse_date(data.data_termino) if data.data_termino else parse_date(m["data_termino"])
        if d_termino < d_inicio:
            raise HTTPException(status_code=400, detail="Data de término não pode ser anterior à data de início.")
        total_dias = (d_termino - d_inicio).days + 1

        updates.extend(["data_inicio = ?", "data_termino = ?", "total_dias = ?"])
        params.extend([str(d_inicio), str(d_termino), total_dias])

        if data.titulo is not None:
            updates.append("titulo = ?")
            params.append(data.titulo.strip())
        if data.justificativa is not None:
            updates.append("justificativa = ?")
            params.append(data.justificativa.strip())
        if data.tipo_missao is not None:
            updates.append("tipo_missao = ?")
            params.append(data.tipo_missao)
        if data.unidade_solicitante is not None:
            updates.append("unidade_solicitante = ?")
            params.append(data.unidade_solicitante)
        if data.unidade_destino is not None:
            updates.append("unidade_destino = ?")
            params.append(data.unidade_destino.strip() or None)
        if data.setor_destino is not None:
            updates.append("setor_destino = ?")
            params.append(data.setor_destino.strip().upper() if data.setor_destino.strip() else None)
        if data.localidade_descricao is not None:
            updates.append("localidade_descricao = ?")
            params.append(data.localidade_descricao.strip())

        eff_meio = _normalize_meio_transporte(
            data.meio_transporte if data.meio_transporte is not None else m["meio_transporte"]
        )
        if eff_meio != "AEREO":
            eff_passagens = 0.0
        elif data.custo_estimado_passagens is not None:
            eff_passagens = float(data.custo_estimado_passagens)
        else:
            eff_passagens = float(m["custo_estimado_passagens"] or 0.0)

        if data.meio_transporte is not None or data.custo_estimado_passagens is not None:
            updates.append("meio_transporte = ?")
            params.append(eff_meio)
            updates.append("custo_estimado_passagens = ?")
            params.append(eff_passagens)

        fields_set = getattr(data, "model_fields_set", set())
        if "responsavel_matricula" in fields_set:
            updates.append("responsavel_matricula = ?")
            params.append(data.responsavel_matricula.strip() if data.responsavel_matricula else None)
        elif data.modalidade and data.modalidade.upper() == "INDIVIDUAL":
            updates.append("responsavel_matricula = NULL")
        if data.missionario_matricula is not None:
            updates.append("missionario_matricula = ?")
            params.append(data.missionario_matricula.strip() if data.missionario_matricula else None)
        if data.modalidade is not None:
            updates.append("modalidade = ?")
            params.append(data.modalidade.upper())

        if data.status_atual is not None:
            st_norm = normalize_canonical_status(data.status_atual)
            if not st_norm:
                raise HTTPException(
                    status_code=400,
                    detail=f"Status '{data.status_atual}' inválido. Valores aceitos: {', '.join(OFFICIAL_STATUSES)}"
                )
            if current_user.get("role") == "CADASTRADOR" and is_approval_restricted_status(st_norm):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Perfil CADASTRADOR não possui permissão para aprovar missões ou emitir OMs/PCDPs."
                )
            updates.append("status_atual = ?")
            params.append(st_norm)
        if data.numero_sat is not None:
            updates.append("numero_sat = ?")
            params.append(data.numero_sat.strip() or None)
        if data.numero_om is not None:
            updates.append("numero_om = ?")
            params.append(data.numero_om.strip() or None)
        if data.numero_pcdp is not None:
            updates.append("numero_pcdp = ?")
            params.append(data.numero_pcdp.strip() or None)
        if data.processo_sei is not None:
            updates.append("processo_sei = ?")
            params.append(data.processo_sei.strip() or None)
        if data.valor_diaria_padrao is not None:
            updates.append("valor_diaria_padrao = ?")
            params.append(float(data.valor_diaria_padrao))
        if data.observacoes is not None:
            updates.append("observacoes = ?")
            params.append(data.observacoes)

        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(m["id"])

        conn.execute(f"UPDATE missoes SET {', '.join(updates)} WHERE id = ?", params)

        # Sincronização de participante em missões individuais
        curr_modalidade = (data.modalidade or m["modalidade"] or "EQUIPE").upper()
        target_missionario = (data.missionario_matricula.strip() or None) if data.missionario_matricula is not None else m["missionario_matricula"]
        if curr_modalidade == "INDIVIDUAL" and target_missionario:
            srv = conn.execute("SELECT matricula, unidade_sigla, is_missionario_geral FROM servidores WHERE matricula = ?", (target_missionario,)).fetchone()
            if not srv:
                raise HTTPException(status_code=404, detail=f"Servidor missionário com matrícula '{target_missionario}' não encontrado.")

            conflict = conn.execute(
                """
                SELECT m.codigo_missao, m.titulo, p.data_apresentacao, p.data_retorno
                FROM missoes_participantes p
                JOIN missoes m ON p.missao_id = m.id
                WHERE p.servidor_matricula = ?
                  AND m.id != ?
                  AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
                  AND p.data_apresentacao <= ?
                  AND p.data_retorno >= ?
                """,
                (target_missionario, m["id"], str(d_termino), str(d_inicio))
            ).fetchone()
            if conflict:
                raise HTTPException(
                    status_code=400,
                    detail=f"Conflito de agenda: Servidor já possui missão ativa '{conflict['codigo_missao']}' de {conflict['data_apresentacao']} a {conflict['data_retorno']}."
                )

            dest = (data.unidade_destino.strip() or None) if data.unidade_destino is not None else m["unidade_destino"]
            is_sede = 1 if ((dest and srv["unidade_sigla"] == dest) or srv["is_missionario_geral"] == 0) else 0
            diaria_val = float(data.valor_diaria_padrao) if data.valor_diaria_padrao is not None else float(m["valor_diaria_padrao"])

            part_row = conn.execute("SELECT * FROM missoes_participantes WHERE missao_id = ?", (m["id"],)).fetchone()
            outros_val = float(part_row["outros_custos"] or 0.0) if part_row else 0.0
            if eff_meio != "AEREO":
                part_passagem = 0.0
            elif data.custo_estimado_passagens is not None or data.meio_transporte is not None:
                part_passagem = eff_passagens
            elif part_row is not None:
                prev_p = float(part_row["valor_passagem_aerea"] or 0.0)
                part_passagem = prev_p if prev_p > 0 else eff_passagens
            else:
                part_passagem = eff_passagens

            fin = compute_participant_financials(
                data_apresentacao=str(d_inicio),
                data_retorno=str(d_termino),
                is_sede=bool(is_sede),
                valor_diaria_unitaria=diaria_val,
                valor_passagem_aerea=part_passagem,
                outros_custos=outros_val
            )
            if part_row:
                conn.execute(
                    """
                    UPDATE missoes_participantes
                    SET servidor_matricula = ?, meio_transporte = ?, data_apresentacao = ?, data_retorno = ?,
                        dias_participacao = ?, is_missao_sede = ?, qtd_diarias = ?,
                        valor_diaria_unitaria = ?, valor_total_diarias = ?,
                        valor_passagem_aerea = ?, custo_total_servidor = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (
                        target_missionario, eff_meio, str(d_inicio), str(d_termino), fin["dias_participacao"],
                        is_sede, fin["qtd_diarias"], fin["valor_diaria_unitaria"],
                        fin["valor_total_diarias"], fin["valor_passagem_aerea"],
                        fin["custo_total_servidor"], part_row["id"]
                    )
                )
            else:
                part_id = f"part-{uuid.uuid4().hex[:10]}"
                conn.execute(
                    """
                    INSERT INTO missoes_participantes (
                        id, missao_id, servidor_matricula, papel, meio_transporte, data_apresentacao,
                        data_retorno, dias_participacao, is_missao_sede, qtd_diarias, valor_diaria_unitaria,
                        valor_total_diarias, valor_passagem_aerea, outros_custos, custo_total_servidor,
                        observacoes
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        part_id, m["id"], target_missionario, "Missionário Individual", eff_meio,
                        str(d_inicio), str(d_termino), fin["dias_participacao"], is_sede,
                        fin["qtd_diarias"], fin["valor_diaria_unitaria"], fin["valor_total_diarias"],
                        fin["valor_passagem_aerea"], 0.0, fin["custo_total_servidor"],
                        "Participante individual vinculado automaticamente."
                    )
                )

        res = _get_missao_full(m["id"], conn)

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="UPDATE",
        entidade_tabela="missoes",
        registro_id=m["id"],
        detalhes=data.model_dump(exclude_unset=True)
    )

    return MissaoOut(**res)

@router.patch("/{codigo_ou_id}/status", response_model=MissaoOut)
def change_missao_status(codigo_ou_id: str, payload: StatusUpdate, request: Request, current_user: dict = Depends(get_current_user)):
    user_role = current_user.get("role")
    if user_role in ("GERENCIAL", "SERVIDOR"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Permissão insuficiente: Perfil de consulta não pode alterar status de missões."
        )

    novo_status = normalize_canonical_status(payload.novo_status)
    if not novo_status:
        raise HTTPException(
            status_code=400,
            detail=f"Status '{payload.novo_status}' inválido. Valores aceitos: {', '.join(OFFICIAL_STATUSES)}"
        )

    # Restrições de perfil para CADASTRADOR
    if user_role == "CADASTRADOR" and is_approval_restricted_status(novo_status):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Perfil CADASTRADOR não possui permissão para aprovar missões ou emitir OMs/PCDPs."
        )

    with get_db() as conn:
        m = conn.execute("SELECT id, status_atual, codigo_missao FROM missoes WHERE id = ? OR codigo_missao = ?", (codigo_ou_id, codigo_ou_id)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Missão não encontrada.")

        status_anterior = m["status_atual"]
        conn.execute(
            "UPDATE missoes SET status_atual = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (novo_status, m["id"])
        )
        res = _get_missao_full(m["id"], conn)

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="STATUS_CHANGE",
        entidade_tabela="missoes",
        registro_id=m["id"],
        detalhes={"de": status_anterior, "para": novo_status, "justificativa": payload.justificativa}
    )

    return MissaoOut(**res)


# ==============================================================================
# CAMPO EDITÁVEL DA DIÁRIA E RECALCULO DINÂMICO
# ==============================================================================
@router.patch("/{codigo_ou_id}/valor-diaria", response_model=MissaoOut)
def update_missao_valor_diaria(
    codigo_ou_id: str,
    payload: ValorDiariaUpdate,
    request: Request,
    current_user: dict = Depends(require_write_permission)
):
    """
    Atualiza o campo de valor da diária para a missão.
    Se recalcular_participantes = True (padrão), recalcula dinamicamente todos
    os participantes vinculados que não sejam efetivo local (sede).
    """
    novo_valor = float(payload.novo_valor_diaria)
    if novo_valor < 0:
        raise HTTPException(status_code=400, detail="O valor da diária não pode ser negativo.")

    with get_db() as conn:
        m = conn.execute("SELECT id, codigo_missao, valor_diaria_padrao FROM missoes WHERE id = ? OR codigo_missao = ?", (codigo_ou_id, codigo_ou_id)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Missão não encontrada.")

        # Atualiza o valor base da diária na missão
        conn.execute(
            "UPDATE missoes SET valor_diaria_padrao = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (novo_valor, m["id"])
        )

        recalculados = 0
        if payload.recalcular_participantes:
            participantes = conn.execute(
                "SELECT * FROM missoes_participantes WHERE missao_id = ?",
                (m["id"],)
            ).fetchall()

            for p in participantes:
                fin = compute_participant_financials(
                    data_apresentacao=p["data_apresentacao"],
                    data_retorno=p["data_retorno"],
                    is_sede=bool(p["is_missao_sede"]),
                    valor_diaria_unitaria=novo_valor,
                    valor_passagem_aerea=p["valor_passagem_aerea"],
                    outros_custos=p["outros_custos"]
                )
                conn.execute(
                    """
                    UPDATE missoes_participantes
                    SET valor_diaria_unitaria = ?,
                        qtd_diarias = ?,
                        valor_total_diarias = ?,
                        custo_total_servidor = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (
                        fin["valor_diaria_unitaria"],
                        fin["qtd_diarias"],
                        fin["valor_total_diarias"],
                        fin["custo_total_servidor"],
                        p["id"]
                    )
                )
                recalculados += 1

        res = _get_missao_full(m["id"], conn)

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="UPDATE_VALOR_DIARIA",
        entidade_tabela="missoes",
        registro_id=m["id"],
        detalhes={
            "valor_anterior": m["valor_diaria_padrao"],
            "novo_valor": novo_valor,
            "participantes_recalculados": recalculados
        }
    )

    return MissaoOut(**res)

# ==============================================================================
# GESTÃO DE PARTICIPANTES DA MISSÃO COM CÁLCULO E CONFLITO DE DATAS
# ==============================================================================
@router.post("/{codigo_ou_id}/participantes", response_model=MissaoOut, status_code=status.HTTP_201_CREATED)
def add_participante(
    codigo_ou_id: str,
    data: ParticipanteCreate,
    request: Request,
    current_user: dict = Depends(require_write_permission)
):
    with get_db() as conn:
        m = conn.execute("SELECT * FROM missoes WHERE id = ? OR codigo_missao = ?", (codigo_ou_id, codigo_ou_id)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Missão não encontrada.")

        s = conn.execute("SELECT * FROM servidores WHERE matricula = ?", (data.servidor_matricula,)).fetchone()
        if not s:
            raise HTTPException(status_code=404, detail=f"Servidor com matrícula '{data.servidor_matricula}' não cadastrado.")

        # Missão individual aceita estritamente apenas 1 servidor
        if (m["modalidade"] or "").upper() == "INDIVIDUAL":
            existing_parts = conn.execute("SELECT COUNT(*) as cnt FROM missoes_participantes WHERE missao_id = ?", (m["id"],)).fetchone()["cnt"]
            if existing_parts >= 1:
                raise HTTPException(status_code=400, detail="Missões na modalidade INDIVIDUAL admitem apenas 1 participante único (missionário).")

        # Verificar se já está na mesma missão nas mesmas datas
        exist = conn.execute(
            """
            SELECT id FROM missoes_participantes
            WHERE missao_id = ? AND servidor_matricula = ? AND data_apresentacao = ?
            """,
            (m["id"], data.servidor_matricula, data.data_apresentacao)
        ).fetchone()
        if exist:
            raise HTTPException(status_code=400, detail="Servidor já está adicionado nesta missão com essa data de apresentação.")

        # Verificar conflito de datas em outras missões ativas
        conflitos = conn.execute(
            """
            SELECT m.codigo_missao, m.titulo, p.data_apresentacao, p.data_retorno
            FROM missoes_participantes p
            JOIN missoes m ON p.missao_id = m.id
            WHERE p.servidor_matricula = ?
              AND m.id != ?
              AND m.status_atual NOT IN ('CANCELADA', 'REJEITADA')
              AND p.data_apresentacao <= ?
              AND p.data_retorno >= ?
            """,
            (data.servidor_matricula, m["id"], data.data_retorno, data.data_apresentacao)
        ).fetchall()

        if conflitos:
            cf_info = ", ".join([f"{c['codigo_missao']} ({c['data_apresentacao']} a {c['data_retorno']})" for c in conflitos])
            # Se for conflito direto, impedimos ou exigimos aviso (retornamos erro claro)
            raise HTTPException(
                status_code=409,
                detail=f"Conflito de agenda: Servidor {s['nome_completo']} ({s['matricula']}) já está alocado no mesmo período na(s) missão(ões): {cf_info}."
            )

        # Regra de isenção local (sede da missão):
        # Se for explicitamente marcada como is_missao_sede OU se o servidor for lotado na unidade de destino OU não-missionário geral
        is_sede = data.is_missao_sede
        if not is_sede:
            if s["is_missionario_geral"] == 0:
                is_sede = True
            elif m["unidade_destino"] and s["unidade_sigla"] == m["unidade_destino"]:
                is_sede = True

        # Valor da diária: se fornecido utiliza o do input, senão herda da missão
        valor_diaria = data.valor_diaria_unitaria if data.valor_diaria_unitaria is not None else float(m["valor_diaria_padrao"])

        fin = compute_participant_financials(
            data_apresentacao=data.data_apresentacao,
            data_retorno=data.data_retorno,
            is_sede=is_sede,
            valor_diaria_unitaria=valor_diaria,
            valor_passagem_aerea=data.valor_passagem_aerea,
            outros_custos=data.outros_custos
        )

        pid = f"part-{uuid.uuid4().hex[:12]}"
        conn.execute(
            """
            INSERT INTO missoes_participantes (
                id, missao_id, servidor_matricula, papel, meio_transporte, data_apresentacao,
                data_retorno, dias_participacao, is_missao_sede, qtd_diarias, valor_diaria_unitaria,
                valor_total_diarias, valor_passagem_aerea, outros_custos, custo_total_servidor,
                localizador_aereo, numero_eticket, observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pid, m["id"], data.servidor_matricula, data.papel, data.meio_transporte,
                data.data_apresentacao, data.data_retorno, fin["dias_participacao"], 1 if is_sede else 0,
                fin["qtd_diarias"], fin["valor_diaria_unitaria"], fin["valor_total_diarias"],
                fin["valor_passagem_aerea"], fin["outros_custos"], fin["custo_total_servidor"],
                data.localizador_aereo, data.numero_eticket, data.observacoes
            )
        )
        res = _get_missao_full(m["id"], conn)

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="ADD_PARTICIPANT",
        entidade_tabela="missoes_participantes",
        registro_id=pid,
        detalhes={
            "missao": m["codigo_missao"],
            "servidor": data.servidor_matricula,
            "is_sede": is_sede,
            "diarias": fin["qtd_diarias"],
            "valor_unitario": fin["valor_diaria_unitaria"]
        }
    )

    return MissaoOut(**res)

@router.put("/{codigo_ou_id}/participantes/{participante_id}", response_model=MissaoOut)
def update_participante(
    codigo_ou_id: str,
    participante_id: str,
    data: ParticipanteUpdate,
    request: Request,
    current_user: dict = Depends(require_write_permission)
):
    with get_db() as conn:
        m = conn.execute("SELECT * FROM missoes WHERE id = ? OR codigo_missao = ?", (codigo_ou_id, codigo_ou_id)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Missão não encontrada.")

        p = conn.execute("SELECT * FROM missoes_participantes WHERE id = ? AND missao_id = ?", (participante_id, m["id"])).fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Participante não encontrado nesta missão.")

        d_apresentacao = data.data_apresentacao or p["data_apresentacao"]
        d_retorno = data.data_retorno or p["data_retorno"]
        is_sede = data.is_missao_sede if data.is_missao_sede is not None else bool(p["is_missao_sede"])
        valor_diaria = data.valor_diaria_unitaria if data.valor_diaria_unitaria is not None else float(p["valor_diaria_unitaria"])
        valor_passagem = data.valor_passagem_aerea if data.valor_passagem_aerea is not None else float(p["valor_passagem_aerea"])
        outros = data.outros_custos if data.outros_custos is not None else float(p["outros_custos"])

        fin = compute_participant_financials(
            data_apresentacao=d_apresentacao,
            data_retorno=d_retorno,
            is_sede=is_sede,
            valor_diaria_unitaria=valor_diaria,
            valor_passagem_aerea=valor_passagem,
            outros_custos=outros
        )

        updates = [
            "data_apresentacao = ?", "data_retorno = ?", "dias_participacao = ?",
            "is_missao_sede = ?", "qtd_diarias = ?", "valor_diaria_unitaria = ?",
            "valor_total_diarias = ?", "valor_passagem_aerea = ?", "outros_custos = ?",
            "custo_total_servidor = ?", "updated_at = CURRENT_TIMESTAMP"
        ]
        params = [
            d_apresentacao, d_retorno, fin["dias_participacao"],
            1 if is_sede else 0, fin["qtd_diarias"], fin["valor_diaria_unitaria"],
            fin["valor_total_diarias"], fin["valor_passagem_aerea"], fin["outros_custos"],
            fin["custo_total_servidor"]
        ]

        if data.papel is not None:
            updates.append("papel = ?")
            params.append(data.papel)
        if data.meio_transporte is not None:
            updates.append("meio_transporte = ?")
            params.append(data.meio_transporte)
        if data.localizador_aereo is not None:
            updates.append("localizador_aereo = ?")
            params.append(data.localizador_aereo)
        if data.numero_eticket is not None:
            updates.append("numero_eticket = ?")
            params.append(data.numero_eticket)
        if data.observacoes is not None:
            updates.append("observacoes = ?")
            params.append(data.observacoes)

        params.append(participante_id)
        conn.execute(f"UPDATE missoes_participantes SET {', '.join(updates)} WHERE id = ?", params)
        res = _get_missao_full(m["id"], conn)

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="UPDATE_PARTICIPANT",
        entidade_tabela="missoes_participantes",
        registro_id=participante_id,
        detalhes=data.model_dump(exclude_unset=True)
    )

    return MissaoOut(**res)

@router.delete("/{codigo_ou_id}/participantes/{participante_id}", response_model=MissaoOut)
def remove_participante(
    codigo_ou_id: str,
    participante_id: str,
    request: Request,
    current_user: dict = Depends(require_write_permission)
):
    with get_db() as conn:
        m = conn.execute("SELECT * FROM missoes WHERE id = ? OR codigo_missao = ?", (codigo_ou_id, codigo_ou_id)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Missão não encontrada.")

        p = conn.execute("SELECT * FROM missoes_participantes WHERE id = ? AND missao_id = ?", (participante_id, m["id"])).fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Participante não encontrado nesta missão.")

        conn.execute("DELETE FROM missoes_participantes WHERE id = ?", (participante_id,))
        res = _get_missao_full(m["id"], conn)

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="REMOVE_PARTICIPANT",
        entidade_tabela="missoes_participantes",
        registro_id=participante_id,
        detalhes={"servidor_matricula": p["servidor_matricula"], "missao": m["codigo_missao"]}
    )

    return MissaoOut(**res)

@router.delete("/{codigo_ou_id}")
def delete_missao(codigo_ou_id: str, request: Request, current_user: dict = Depends(require_admin)):
    with get_db() as conn:
        m = conn.execute("SELECT id, codigo_missao, status_atual FROM missoes WHERE id = ? OR codigo_missao = ?", (codigo_ou_id, codigo_ou_id)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Missão não encontrada.")

        # Se missão já estiver com OM emitida ou concluída, cancelamos em vez de apagar
        if m["status_atual"] in ("OM_EMITIDA", "OM EMITIDA", "PCDP_TRAMITADA", "PCDP CADASTRADA", "PCDP ENCAMINHADA", "PCDP PRESTAR CONTAS", "EM_ANDAMENTO") or m["status_atual"] in CONCLUDED_STATUS_VALUES:
            conn.execute("UPDATE missoes SET status_atual = 'CANCELADA', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (m["id"],))
            action = "CANCEL"
            msg = f"Missão {m['codigo_missao']} cancelada formalmente (mantida para auditoria financeira)."
        else:
            conn.execute("DELETE FROM missoes WHERE id = ?", (m["id"],))
            action = "DELETE"
            msg = f"Missão {m['codigo_missao']} excluída com sucesso."

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao=action,
        entidade_tabela="missoes",
        registro_id=m["id"],
        detalhes={"codigo_missao": m["codigo_missao"]}
    )

    return {"status": "ok", "message": msg}

# Endpoints de apoio e tabelas de domínio
@router.get("/meta/tipos")
def get_tipos_missao(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM tipos_missao WHERE ativo = 1 ORDER BY nome").fetchall()
    return [dict(r) for r in rows]

@router.get("/meta/papeis")
def get_papeis_missao(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM papeis_missao ORDER BY nome").fetchall()
    return [dict(r) for r in rows]

@router.get("/meta/unidades")
def get_unidades(
    q: Optional[str] = None,
    uf: Optional[str] = None,
    ativo: Optional[bool] = None,
    todas: Optional[bool] = False,
    current_user: dict = Depends(get_current_user)
):
    query = "SELECT * FROM orgao_unidades WHERE 1=1"
    params = []
    if q:
        query += " AND (sigla LIKE ? OR nome_extenso LIKE ? OR municipio LIKE ?)"
        term = f"%{q.strip()}%"
        params.extend([term, term, term])
    if uf:
        query += " AND uf = ?"
        params.append(uf.upper())
    if todas:
        if ativo is not None:
            query += " AND ativo = ?"
            params.append(1 if ativo else 0)
    elif ativo is not None:
        query += " AND ativo = ?"
        params.append(1 if ativo else 0)
    else:
        query += " AND ativo = 1"

    query += """
        ORDER BY 
            CASE sigla 
                WHEN 'SR/PF/PB' THEN 1 
                WHEN 'CGE/PF/PB' THEN 2 
                WHEN 'PAT/PF/PB' THEN 3 
                ELSE 4 
            END, 
            sigla ASC
    """
    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(r) for r in rows]

@router.post("/meta/unidades", response_model=OrgaoUnidadeOut, status_code=status.HTTP_201_CREATED)
def create_unidade(data: OrgaoUnidadeCreate, request: Request, current_user: dict = Depends(require_admin)):
    uid = f"unid-{uuid.uuid4().hex[:8]}"
    sigla = data.sigla.strip().upper()

    v_diaria = data.valor_diaria
    cat_diaria = data.categoria_diaria
    tipo_unid = data.tipo_unidade

    if not v_diaria or v_diaria <= 0:
        if sigla.startswith("DPF/") or "DELEGACIA" in data.nome_extenso.upper():
            v_diaria = 335.00
            cat_diaria = "INTERIOR"
            tipo_unid = "DELEGACIA"
        elif data.uf in ("DF", "RJ", "SP", "AM"):
            v_diaria = 425.00
            cat_diaria = "CAPITAIS_ESPECIAIS"
            tipo_unid = "SUPERINTENDENCIA" if sigla.startswith("SR/") else "DIRETORIA_DIVISAO"
        else:
            v_diaria = 380.00
            cat_diaria = "CAPITAIS"
            tipo_unid = "SUPERINTENDENCIA"

    with get_db() as conn:
        exist = conn.execute("SELECT id FROM orgao_unidades WHERE sigla = ?", (sigla,)).fetchone()
        if exist:
            raise HTTPException(status_code=400, detail=f"Unidade com sigla '{sigla}' já cadastrada.")
        conn.execute(
            """
            INSERT INTO orgao_unidades (id, sigla, nome_extenso, municipio, uf, is_fronteira, valor_diaria, categoria_diaria, tipo_unidade, ativo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (uid, sigla, data.nome_extenso.strip(), data.municipio.strip(), data.uf.strip().upper(), 1 if data.is_fronteira else 0, v_diaria, cat_diaria, tipo_unid, 1 if data.ativo else 0)
        )
    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="CREATE",
        entidade_tabela="orgao_unidades",
        registro_id=uid,
        detalhes=data.model_dump()
    )
    return OrgaoUnidadeOut(
        id=uid, sigla=sigla, nome_extenso=data.nome_extenso,
        municipio=data.municipio, uf=data.uf, is_fronteira=data.is_fronteira,
        valor_diaria=v_diaria, categoria_diaria=cat_diaria, tipo_unidade=tipo_unid, ativo=data.ativo
    )

@router.put("/meta/unidades/{sigla_ou_id:path}", response_model=OrgaoUnidadeOut)
def update_unidade(sigla_ou_id: str, data: OrgaoUnidadeUpdate, request: Request, current_user: dict = Depends(require_admin)):
    with get_db() as conn:
        u = conn.execute("SELECT * FROM orgao_unidades WHERE id = ? OR sigla = ?", (sigla_ou_id, sigla_ou_id.upper())).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="Unidade não encontrada.")
        updates = []
        params = []
        if data.nome_extenso is not None:
            updates.append("nome_extenso = ?")
            params.append(data.nome_extenso.strip())
        if data.municipio is not None:
            updates.append("municipio = ?")
            params.append(data.municipio.strip())
        if data.uf is not None:
            updates.append("uf = ?")
            params.append(data.uf.strip().upper())
        if data.is_fronteira is not None:
            updates.append("is_fronteira = ?")
            params.append(1 if data.is_fronteira else 0)
        if data.valor_diaria is not None:
            updates.append("valor_diaria = ?")
            params.append(data.valor_diaria)
        if data.categoria_diaria is not None:
            updates.append("categoria_diaria = ?")
            params.append(data.categoria_diaria)
        if data.tipo_unidade is not None:
            updates.append("tipo_unidade = ?")
            params.append(data.tipo_unidade)
        if data.ativo is not None:
            updates.append("ativo = ?")
            params.append(1 if data.ativo else 0)
        if updates:
            params.append(u["id"])
            conn.execute(f"UPDATE orgao_unidades SET {', '.join(updates)} WHERE id = ?", params)
        res = conn.execute("SELECT * FROM orgao_unidades WHERE id = ?", (u["id"],)).fetchone()

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="UPDATE",
        entidade_tabela="orgao_unidades",
        registro_id=u["id"],
        detalhes=data.model_dump(exclude_unset=True)
    )
    return OrgaoUnidadeOut(
        id=res["id"],
        sigla=res["sigla"],
        nome_extenso=res["nome_extenso"],
        municipio=res["municipio"],
        uf=res["uf"],
        is_fronteira=bool(res["is_fronteira"]),
        valor_diaria=float(res["valor_diaria"] or 380.00),
        categoria_diaria=res["categoria_diaria"] or "CAPITAIS",
        tipo_unidade=res["tipo_unidade"] or "CAPITAL",
        ativo=bool(res["ativo"]),
        created_at=str(res["created_at"])
    )

@router.delete("/meta/unidades/{sigla_ou_id:path}")
def delete_unidade(sigla_ou_id: str, request: Request, current_user: dict = Depends(require_admin)):
    with get_db() as conn:
        u = conn.execute("SELECT * FROM orgao_unidades WHERE id = ? OR sigla = ?", (sigla_ou_id, sigla_ou_id.upper())).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="Unidade não encontrada.")
        conn.execute("UPDATE orgao_unidades SET ativo = 0 WHERE id = ?", (u["id"],))

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="DEACTIVATE",
        entidade_tabela="orgao_unidades",
        registro_id=u["id"],
        detalhes={"sigla": u["sigla"]}
    )
    return {"status": "ok", "message": f"Unidade '{u['sigla']}' desativada com sucesso."}

@router.get("/meta/cargos")
def get_cargos(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cargos ORDER BY sigla").fetchall()
    return [dict(r) for r in rows]

# Endpoints de Valores de Diárias
@router.get("/meta/valores-diarias", response_model=List[ValorDiariaItem])
def get_valores_diarias(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM valores_diarias ORDER BY valor ASC").fetchall()
    return [
        ValorDiariaItem(
            id=r["id"],
            categoria=r["categoria"],
            descricao=r["descricao"],
            valor=float(r["valor"]),
            ativo=bool(r["ativo"]),
            created_at=str(r["created_at"])
        )
        for r in rows
    ]

@router.put("/meta/valores-diarias/{id_ou_cat}", response_model=ValorDiariaItem)
def update_valor_diaria(
    id_ou_cat: str,
    data: ValorDiariaItemUpdate,
    request: Request,
    current_user: dict = Depends(require_admin)
):
    with get_db() as conn:
        r = conn.execute(
            "SELECT * FROM valores_diarias WHERE id = ? OR categoria = ?",
            (id_ou_cat, id_ou_cat.upper())
        ).fetchone()
        if not r:
            raise HTTPException(status_code=404, detail="Registro de valor de diária não encontrado.")

        updates = ["valor = ?"]
        params = [data.valor]
        if data.descricao is not None:
            updates.append("descricao = ?")
            params.append(data.descricao.strip())
        if data.ativo is not None:
            updates.append("ativo = ?")
            params.append(1 if data.ativo else 0)
        params.append(r["id"])
        conn.execute(f"UPDATE valores_diarias SET {', '.join(updates)} WHERE id = ?", params)

        # Atualizar unidades vinculadas a esta categoria
        conn.execute("UPDATE orgao_unidades SET valor_diaria = ? WHERE categoria_diaria = ?", (data.valor, r["categoria"]))

        updated = conn.execute("SELECT * FROM valores_diarias WHERE id = ?", (r["id"],)).fetchone()

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="UPDATE_VALOR_DIARIA",
        entidade_tabela="valores_diarias",
        registro_id=r["id"],
        detalhes={"valor_anterior": r["valor"], "novo_valor": data.valor, "categoria": r["categoria"]}
    )

    return ValorDiariaItem(
        id=updated["id"],
        categoria=updated["categoria"],
        descricao=updated["descricao"],
        valor=float(updated["valor"]),
        ativo=bool(updated["ativo"]),
        created_at=str(updated["created_at"])
    )

# Endpoints de Setores de Destino
@router.get("/meta/setores", response_model=List[SetorDestinoOut])
def get_setores(
    unidade_pai: Optional[str] = "SR/PF/PB",
    current_user: dict = Depends(get_current_user)
):
    with get_db() as conn:
        if unidade_pai:
            rows = conn.execute(
                "SELECT * FROM setores_destino WHERE unidade_pai_sigla = ? AND ativo = 1 ORDER BY sigla ASC",
                (unidade_pai.strip().upper(),)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM setores_destino WHERE ativo = 1 ORDER BY sigla ASC").fetchall()
    return [
        SetorDestinoOut(
            id=r["id"],
            sigla=r["sigla"],
            nome=r["nome"],
            unidade_pai_sigla=r["unidade_pai_sigla"],
            ativo=bool(r["ativo"]),
            created_at=str(r["created_at"])
        )
        for r in rows
    ]

@router.post("/meta/setores", response_model=SetorDestinoOut, status_code=status.HTTP_201_CREATED)
def create_setor(data: SetorDestinoCreate, request: Request, current_user: dict = Depends(require_admin)):
    sigla = data.sigla.strip().upper()
    sid = f"setor-pb-{sigla.lower().replace('/', '-').replace('ç', 'c')}"
    with get_db() as conn:
        exist = conn.execute("SELECT id FROM setores_destino WHERE sigla = ?", (sigla,)).fetchone()
        if exist:
            raise HTTPException(status_code=400, detail=f"Setor com a sigla '{sigla}' já existe.")
        conn.execute(
            """
            INSERT INTO setores_destino (id, sigla, nome, unidade_pai_sigla, ativo)
            VALUES (?, ?, ?, ?, 1)
            """,
            (sid, sigla, data.nome.strip(), data.unidade_pai_sigla.strip().upper())
        )
    return SetorDestinoOut(id=sid, sigla=sigla, nome=data.nome, unidade_pai_sigla=data.unidade_pai_sigla, ativo=True)

