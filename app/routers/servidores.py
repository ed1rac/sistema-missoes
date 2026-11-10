import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status, Request
from app.schemas import ServidorCreate, ServidorUpdate, ServidorOut
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.audit import log_audit

router = APIRouter(prefix="/api/servidores", tags=["Servidores da PF"])

@router.get("", response_model=List[ServidorOut])
def list_servidores(
    q: Optional[str] = None,
    cargo: Optional[str] = None,
    unidade: Optional[str] = None,
    tpe: Optional[bool] = None,
    is_missionario: Optional[bool] = None,
    ativo: Optional[bool] = None,
    current_user: dict = Depends(get_current_user)
):
    query = "SELECT * FROM servidores WHERE 1=1"
    params = []

    if q:
        query += " AND (matricula LIKE ? OR nome_completo LIKE ? OR nome_guerra LIKE ? OR email_institucional LIKE ?)"
        term = f"%{q.strip()}%"
        params.extend([term, term, term, term])

    if cargo:
        query += " AND cargo_sigla = ?"
        params.append(cargo)

    if unidade:
        query += " AND unidade_sigla = ?"
        params.append(unidade)

    if tpe is not None:
        query += " AND tpe = ?"
        params.append(1 if tpe else 0)

    if is_missionario is not None:
        query += " AND is_missionario_geral = ?"
        params.append(1 if is_missionario else 0)

    if ativo is not None:
        query += " AND ativo = ?"
        params.append(1 if ativo else 0)

    query += " ORDER BY nome_completo ASC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    return [
        ServidorOut(
            id=r["id"],
            matricula=r["matricula"],
            nome_completo=r["nome_completo"],
            nome_guerra=r["nome_guerra"],
            cargo_sigla=r["cargo_sigla"],
            unidade_sigla=r["unidade_sigla"],
            login_rede=r["login_rede"],
            email_institucional=r["email_institucional"],
            telefone_celular=r["telefone_celular"],
            tpe=bool(r["tpe"]),
            is_missionario_geral=bool(r["is_missionario_geral"]),
            observacoes_gerais=r["observacoes_gerais"],
            ativo=bool(r["ativo"]),
            created_at=str(r["created_at"]),
            updated_at=str(r["updated_at"])
        )
        for r in rows
    ]

@router.get("/{matricula}", response_model=ServidorOut)
def get_servidor(matricula: str, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        r = conn.execute("SELECT * FROM servidores WHERE matricula = ?", (matricula,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Servidor não encontrado com a matrícula informada.")
    return ServidorOut(
        id=r["id"],
        matricula=r["matricula"],
        nome_completo=r["nome_completo"],
        nome_guerra=r["nome_guerra"],
        cargo_sigla=r["cargo_sigla"],
        unidade_sigla=r["unidade_sigla"],
        login_rede=r["login_rede"],
        email_institucional=r["email_institucional"],
        telefone_celular=r["telefone_celular"],
        tpe=bool(r["tpe"]),
        is_missionario_geral=bool(r["is_missionario_geral"]),
        observacoes_gerais=r["observacoes_gerais"],
        ativo=bool(r["ativo"]),
        created_at=str(r["created_at"]),
        updated_at=str(r["updated_at"])
    )

@router.post("", response_model=ServidorOut, status_code=status.HTTP_201_CREATED)
def create_servidor(data: ServidorCreate, request: Request, current_user: dict = Depends(require_admin)):
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM servidores WHERE matricula = ?", (data.matricula,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail=f"Já existe servidor cadastrado com a matrícula {data.matricula}.")

        sid = f"srv-{uuid.uuid4().hex[:12]}"
        conn.execute(
            """
            INSERT INTO servidores (
                id, matricula, nome_completo, nome_guerra, cargo_sigla, unidade_sigla,
                login_rede, email_institucional, telefone_celular, tpe, is_missionario_geral,
                observacoes_gerais, ativo
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sid, data.matricula, data.nome_completo.strip().upper(),
                data.nome_guerra.strip().upper() if data.nome_guerra else None,
                data.cargo_sigla, data.unidade_sigla, data.login_rede,
                data.email_institucional.lower(), data.telefone_celular,
                1 if data.tpe else 0, 1 if data.is_missionario_geral else 0,
                data.observacoes_gerais, 1 if data.ativo else 0
            )
        )
        row = conn.execute("SELECT * FROM servidores WHERE id = ?", (sid,)).fetchone()

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="CREATE",
        entidade_tabela="servidores",
        registro_id=sid,
        detalhes={"matricula": data.matricula, "nome": data.nome_completo}
    )

    return ServidorOut(
        id=row["id"],
        matricula=row["matricula"],
        nome_completo=row["nome_completo"],
        nome_guerra=row["nome_guerra"],
        cargo_sigla=row["cargo_sigla"],
        unidade_sigla=row["unidade_sigla"],
        login_rede=row["login_rede"],
        email_institucional=row["email_institucional"],
        telefone_celular=row["telefone_celular"],
        tpe=bool(row["tpe"]),
        is_missionario_geral=bool(row["is_missionario_geral"]),
        observacoes_gerais=row["observacoes_gerais"],
        ativo=bool(row["ativo"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"])
    )

@router.put("/{matricula}", response_model=ServidorOut)
def update_servidor(matricula: str, data: ServidorUpdate, request: Request, current_user: dict = Depends(require_admin)):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM servidores WHERE matricula = ?", (matricula,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Servidor não encontrado.")

        updates = []
        params = []
        if data.nome_completo is not None:
            updates.append("nome_completo = ?")
            params.append(data.nome_completo.strip().upper())
        if data.nome_guerra is not None:
            updates.append("nome_guerra = ?")
            params.append(data.nome_guerra.strip().upper() if data.nome_guerra else None)
        if data.cargo_sigla is not None:
            updates.append("cargo_sigla = ?")
            params.append(data.cargo_sigla)
        if data.unidade_sigla is not None:
            updates.append("unidade_sigla = ?")
            params.append(data.unidade_sigla)
        if data.login_rede is not None:
            updates.append("login_rede = ?")
            params.append(data.login_rede)
        if data.email_institucional is not None:
            updates.append("email_institucional = ?")
            params.append(data.email_institucional.lower())
        if data.telefone_celular is not None:
            updates.append("telefone_celular = ?")
            params.append(data.telefone_celular)
        if data.tpe is not None:
            updates.append("tpe = ?")
            params.append(1 if data.tpe else 0)
        if data.is_missionario_geral is not None:
            updates.append("is_missionario_geral = ?")
            params.append(1 if data.is_missionario_geral else 0)
        if data.observacoes_gerais is not None:
            updates.append("observacoes_gerais = ?")
            params.append(data.observacoes_gerais)
        if data.ativo is not None:
            updates.append("ativo = ?")
            params.append(1 if data.ativo else 0)

        if updates:
            updates.append("updated_at = CURRENT_TIMESTAMP")
            params.append(matricula)
            conn.execute(f"UPDATE servidores SET {', '.join(updates)} WHERE matricula = ?", params)

        row = conn.execute("SELECT * FROM servidores WHERE matricula = ?", (matricula,)).fetchone()

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="UPDATE",
        entidade_tabela="servidores",
        registro_id=row["id"],
        detalhes={"matricula": matricula, "modificacoes": data.model_dump(exclude_unset=True)}
    )

    return ServidorOut(
        id=row["id"],
        matricula=row["matricula"],
        nome_completo=row["nome_completo"],
        nome_guerra=row["nome_guerra"],
        cargo_sigla=row["cargo_sigla"],
        unidade_sigla=row["unidade_sigla"],
        login_rede=row["login_rede"],
        email_institucional=row["email_institucional"],
        telefone_celular=row["telefone_celular"],
        tpe=bool(row["tpe"]),
        is_missionario_geral=bool(row["is_missionario_geral"]),
        observacoes_gerais=row["observacoes_gerais"],
        ativo=bool(row["ativo"]),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"])
    )

@router.delete("/{matricula}")
def delete_servidor(matricula: str, request: Request, current_user: dict = Depends(require_admin)):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM servidores WHERE matricula = ?", (matricula,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Servidor não encontrado.")

        # Verificar se possui missões vinculadas
        part_count = conn.execute(
            "SELECT COUNT(*) as cnt FROM missoes_participantes WHERE servidor_matricula = ?",
            (matricula,)
        ).fetchone()["cnt"]

        if part_count > 0:
            # Desativação lógica para manter integridade histórica
            conn.execute("UPDATE servidores SET ativo = 0, updated_at = CURRENT_TIMESTAMP WHERE matricula = ?", (matricula,))
            action = "DEACTIVATE"
            msg = f"Servidor {matricula} desativado (mantido no histórico pois possui participações registradas)."
        else:
            conn.execute("DELETE FROM servidores WHERE matricula = ?", (matricula,))
            action = "DELETE"
            msg = f"Servidor {matricula} excluído com sucesso."

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao=action,
        entidade_tabela="servidores",
        registro_id=existing["id"],
        detalhes={"matricula": matricula}
    )

    return {"status": "ok", "message": msg}
