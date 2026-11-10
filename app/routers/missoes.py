import uuid
from datetime import date
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status, Request
from app.schemas import (
    MissaoCreate, MissaoUpdate, MissaoOut,
    ParticipanteCreate, ParticipanteUpdate, ParticipanteOut,
    StatusUpdate, ValorDiariaUpdate
)
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.calculator import compute_participant_financials, parse_date
from app.audit import log_audit

router = APIRouter(prefix="/api/missoes", tags=["Missões Institucionais"])

def _format_participante(row: dict) -> ParticipanteOut:
    return ParticipanteOut(
        id=row["id"],
        missao_id=row["missao_id"],
        servidor_matricula=row["servidor_matricula"],
        servidor_nome=row.get("servidor_nome"),
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
        SELECT m.*, s.nome_completo as responsavel_nome
        FROM missoes m
        LEFT JOIN servidores s ON m.responsavel_matricula = s.matricula
        WHERE m.id = ? OR m.codigo_missao = ?
        """,
        (missao_id_or_code, missao_id_or_code)
    ).fetchone()
    if not m:
        return None

    # Participantes com dados do servidor
    p_rows = conn.execute(
        """
        SELECT p.*, s.nome_completo as servidor_nome, s.cargo_sigla as servidor_cargo, s.unidade_sigla as servidor_lotacao
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
    data_de: Optional[str] = None,
    data_ate: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    query = """
        SELECT m.*, s.nome_completo as responsavel_nome,
               COUNT(p.id) as total_participantes,
               COALESCE(SUM(p.valor_total_diarias), 0.0) as total_custo_diarias,
               COALESCE(SUM(p.valor_passagem_aerea), 0.0) as total_custo_passagens,
               COALESCE(SUM(p.custo_total_servidor), 0.0) as total_custo_geral
        FROM missoes m
        LEFT JOIN servidores s ON m.responsavel_matricula = s.matricula
        LEFT JOIN missoes_participantes p ON m.id = p.missao_id
        WHERE 1=1
    """
    params = []

    if q:
        query += " AND (m.codigo_missao LIKE ? OR m.titulo LIKE ? OR m.localidade_descricao LIKE ? OR m.numero_om LIKE ? OR m.numero_pcdp LIKE ?)"
        term = f"%{q.strip()}%"
        params.extend([term, term, term, term, term])

    if status:
        query += " AND m.status_atual = ?"
        params.append(status)

    if tipo:
        query += " AND m.tipo_missao = ?"
        params.append(tipo)

    if solicitante:
        query += " AND m.unidade_solicitante = ?"
        params.append(solicitante)

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
            localidade_descricao=r["localidade_descricao"],
            data_inicio=str(r["data_inicio"]),
            data_termino=str(r["data_termino"]),
            total_dias=int(r["total_dias"]),
            responsavel_matricula=r["responsavel_matricula"],
            responsavel_nome=r["responsavel_nome"],
            status_atual=r["status_atual"],
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
def create_missao(data: MissaoCreate, request: Request, current_user: dict = Depends(require_admin)):
    d_inicio = parse_date(data.data_inicio)
    d_termino = parse_date(data.data_termino)
    if d_termino < d_inicio:
        raise HTTPException(status_code=400, detail="Data de término não pode ser anterior à data de início.")

    total_dias = (d_termino - d_inicio).days + 1
    mid = f"mis-{uuid.uuid4().hex[:12]}"

    with get_db() as conn:
        # Verifica se código já existe
        exist = conn.execute("SELECT id FROM missoes WHERE codigo_missao = ?", (data.codigo_missao.strip(),)).fetchone()
        if exist:
            raise HTTPException(status_code=400, detail=f"Já existe missão com o código {data.codigo_missao}.")

        # Se valor_diaria_padrao não informado ou zero, buscar do sistema
        valor_diaria = data.valor_diaria_padrao
        if not valor_diaria or valor_diaria <= 0:
            cfg = conn.execute("SELECT valor FROM configuracoes WHERE chave = 'valor_diaria_padrao'").fetchone()
            valor_diaria = float(cfg["valor"]) if cfg else 425.00

        conn.execute(
            """
            INSERT INTO missoes (
                id, codigo_missao, titulo, justificativa, tipo_missao, unidade_solicitante,
                unidade_destino, localidade_descricao, data_inicio, data_termino, total_dias,
                responsavel_matricula, status_atual, numero_sat, numero_om, numero_pcdp,
                processo_sei, valor_diaria_padrao, observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                mid, data.codigo_missao.strip(), data.titulo.strip(), data.justificativa.strip(),
                data.tipo_missao, data.unidade_solicitante, data.unidade_destino,
                data.localidade_descricao.strip(), str(d_inicio), str(d_termino), total_dias,
                data.responsavel_matricula, data.status_atual or "RASCUNHO",
                data.numero_sat, data.numero_om, data.numero_pcdp, data.processo_sei,
                valor_diaria, data.observacoes
            )
        )
        res = _get_missao_full(mid, conn)

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="CREATE",
        entidade_tabela="missoes",
        registro_id=mid,
        detalhes={"codigo_missao": data.codigo_missao, "titulo": data.titulo, "valor_diaria": valor_diaria}
    )

    return MissaoOut(**res)

@router.put("/{codigo_ou_id}", response_model=MissaoOut)
def update_missao(codigo_ou_id: str, data: MissaoUpdate, request: Request, current_user: dict = Depends(require_admin)):
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
            params.append(data.unidade_destino)
        if data.localidade_descricao is not None:
            updates.append("localidade_descricao = ?")
            params.append(data.localidade_descricao.strip())
        if data.responsavel_matricula is not None:
            updates.append("responsavel_matricula = ?")
            params.append(data.responsavel_matricula)
        if data.status_atual is not None:
            updates.append("status_atual = ?")
            params.append(data.status_atual)
        if data.numero_sat is not None:
            updates.append("numero_sat = ?")
            params.append(data.numero_sat)
        if data.numero_om is not None:
            updates.append("numero_om = ?")
            params.append(data.numero_om)
        if data.numero_pcdp is not None:
            updates.append("numero_pcdp = ?")
            params.append(data.numero_pcdp)
        if data.processo_sei is not None:
            updates.append("processo_sei = ?")
            params.append(data.processo_sei)
        if data.valor_diaria_padrao is not None:
            updates.append("valor_diaria_padrao = ?")
            params.append(float(data.valor_diaria_padrao))
        if data.observacoes is not None:
            updates.append("observacoes = ?")
            params.append(data.observacoes)

        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(m["id"])

        conn.execute(f"UPDATE missoes SET {', '.join(updates)} WHERE id = ?", params)
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
def change_missao_status(codigo_ou_id: str, payload: StatusUpdate, request: Request, current_user: dict = Depends(require_admin)):
    status_permitidos = [
        "RASCUNHO", "SOLICITADA", "EM_ANALISE", "REJEITADA", "APROVADA",
        "OM_EMITIDA", "PCDP_TRAMITADA", "EM_ANDAMENTO", "PRESTACAO_CONTAS",
        "CONCLUIDA", "CANCELADA"
    ]
    novo_status = payload.novo_status.upper()
    if novo_status not in status_permitidos:
        raise HTTPException(
            status_code=400,
            detail=f"Status '{payload.novo_status}' inválido. Valores aceitos: {', '.join(status_permitidos)}"
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
    current_user: dict = Depends(require_admin)
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
    current_user: dict = Depends(require_admin)
):
    with get_db() as conn:
        m = conn.execute("SELECT * FROM missoes WHERE id = ? OR codigo_missao = ?", (codigo_ou_id, codigo_ou_id)).fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Missão não encontrada.")

        s = conn.execute("SELECT * FROM servidores WHERE matricula = ?", (data.servidor_matricula,)).fetchone()
        if not s:
            raise HTTPException(status_code=404, detail=f"Servidor com matrícula '{data.servidor_matricula}' não cadastrado.")

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
    current_user: dict = Depends(require_admin)
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
    current_user: dict = Depends(require_admin)
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
        if m["status_atual"] in ("OM_EMITIDA", "PCDP_TRAMITADA", "EM_ANDAMENTO", "CONCLUIDA"):
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
def get_unidades(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM orgao_unidades WHERE ativo = 1 ORDER BY sigla").fetchall()
    return [dict(r) for r in rows]

@router.get("/meta/cargos")
def get_cargos(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM cargos ORDER BY sigla").fetchall()
    return [dict(r) for r in rows]
