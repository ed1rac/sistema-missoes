import sqlite3
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status, Request
from app.schemas import ServidorCreate, ServidorUpdate, ServidorOut
from app.auth import get_current_user, require_admin, require_write_permission
from app.database import get_db
from app.audit import log_audit

router = APIRouter(prefix="/api/servidores", tags=["Servidores da PF"])


def _clean_opt(val: Optional[str]) -> Optional[str]:
    if val is None:
        return None
    cleaned = val.strip()
    return cleaned if cleaned else None


def _row_to_servidor_out(r) -> ServidorOut:
    return ServidorOut(
        id=r["id"],
        matricula=r["matricula"],
        nome_completo=r["nome_completo"],
        nome_guerra=r["nome_guerra"],
        cpf=r["cpf"] if "cpf" in r.keys() else None,
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
        updated_at=str(r["updated_at"]),
    )


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
        query += " AND (matricula LIKE ? OR nome_completo LIKE ? OR nome_guerra LIKE ? OR cpf LIKE ? OR login_rede LIKE ? OR email_institucional LIKE ?)"
        term = f"%{q.strip()}%"
        params.extend([term, term, term, term, term, term])

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

    return [_row_to_servidor_out(r) for r in rows]


@router.get("/{matricula}", response_model=ServidorOut)
def get_servidor(matricula: str, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        r = conn.execute("SELECT * FROM servidores WHERE matricula = ?", (matricula,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Servidor não encontrado com a matrícula informada.")
    return _row_to_servidor_out(r)


@router.post("", response_model=ServidorOut, status_code=status.HTTP_201_CREATED)
def create_servidor(data: ServidorCreate, request: Request, current_user: dict = Depends(require_write_permission)):
    matricula_clean = data.matricula.strip()
    if not matricula_clean:
        raise HTTPException(status_code=400, detail="Matrícula funcional é obrigatória.")

    login_rede = _clean_opt(data.login_rede)
    email_inst = _clean_opt(data.email_institucional)
    if not email_inst:
        base_local = (login_rede.lower() if login_rede else f"srv.{matricula_clean.lower()}").replace(" ", ".")
        email_inst = f"{base_local}@pf.gov.br"
    else:
        email_inst = email_inst.lower()

    cpf_clean = _clean_opt(data.cpf)
    nome_guerra = _clean_opt(data.nome_guerra)
    if nome_guerra:
        nome_guerra = nome_guerra.upper()
    telefone = _clean_opt(data.telefone_celular)

    with get_db() as conn:
        existing = conn.execute("SELECT id FROM servidores WHERE matricula = ?", (matricula_clean,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail=f"Já existe servidor cadastrado com a matrícula {matricula_clean}.")

        if login_rede:
            dup_login = conn.execute("SELECT id, matricula FROM servidores WHERE login_rede = ?", (login_rede,)).fetchone()
            if dup_login:
                raise HTTPException(status_code=400, detail=f"Login de rede '{login_rede}' já está vinculado ao servidor matrícula {dup_login['matricula']}.")

        dup_email = conn.execute("SELECT id, matricula FROM servidores WHERE email_institucional = ?", (email_inst,)).fetchone()
        if dup_email:
            # Se o e-mail foi gerado automaticamente e colidiu, diferencia pela matrícula
            if not _clean_opt(data.email_institucional):
                email_inst = f"srv.{matricula_clean.lower()}.{uuid.uuid4().hex[:4]}@pf.gov.br"
            else:
                raise HTTPException(status_code=400, detail=f"E-mail institucional '{email_inst}' já está vinculado ao servidor matrícula {dup_email['matricula']}.")

        sid = f"srv-{uuid.uuid4().hex[:12]}"
        try:
            conn.execute(
                """
                INSERT INTO servidores (
                    id, matricula, nome_completo, nome_guerra, cpf, cargo_sigla, unidade_sigla,
                    login_rede, email_institucional, telefone_celular, tpe, is_missionario_geral,
                    observacoes_gerais, ativo
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sid, matricula_clean, data.nome_completo.strip().upper(),
                    nome_guerra, cpf_clean,
                    data.cargo_sigla, data.unidade_sigla, login_rede,
                    email_inst, telefone,
                    1 if data.tpe else 0, 1 if data.is_missionario_geral else 0,
                    data.observacoes_gerais, 1 if data.ativo else 0
                )
            )
        except sqlite3.IntegrityError as exc:
            msg = str(exc)
            if "login_rede" in msg:
                raise HTTPException(status_code=400, detail=f"Login de rede '{login_rede}' já cadastrado para outro servidor.")
            if "email_institucional" in msg:
                raise HTTPException(status_code=400, detail=f"E-mail institucional '{email_inst}' já cadastrado para outro servidor.")
            raise HTTPException(status_code=400, detail=f"Conflito de integridade ao cadastrar servidor: {msg}")

        row = conn.execute("SELECT * FROM servidores WHERE id = ?", (sid,)).fetchone()

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="CREATE",
        entidade_tabela="servidores",
        registro_id=sid,
        detalhes={"matricula": matricula_clean, "nome": data.nome_completo}
    )

    return _row_to_servidor_out(row)


@router.put("/{matricula}", response_model=ServidorOut)
def update_servidor(matricula: str, data: ServidorUpdate, request: Request, current_user: dict = Depends(require_write_permission)):
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
            ng = _clean_opt(data.nome_guerra)
            updates.append("nome_guerra = ?")
            params.append(ng.upper() if ng else None)
        if data.cpf is not None:
            updates.append("cpf = ?")
            params.append(_clean_opt(data.cpf))
        if data.cargo_sigla is not None:
            updates.append("cargo_sigla = ?")
            params.append(data.cargo_sigla)
        if data.unidade_sigla is not None:
            updates.append("unidade_sigla = ?")
            params.append(data.unidade_sigla)
        if data.login_rede is not None:
            login_val = _clean_opt(data.login_rede)
            if login_val:
                dup_login = conn.execute(
                    "SELECT matricula FROM servidores WHERE login_rede = ? AND matricula != ?",
                    (login_val, matricula)
                ).fetchone()
                if dup_login:
                    raise HTTPException(status_code=400, detail=f"Login de rede '{login_val}' já pertence ao servidor matrícula {dup_login['matricula']}.")
            updates.append("login_rede = ?")
            params.append(login_val)
        if data.email_institucional is not None:
            email_val = _clean_opt(data.email_institucional)
            if email_val:
                email_val = email_val.lower()
                dup_email = conn.execute(
                    "SELECT matricula FROM servidores WHERE email_institucional = ? AND matricula != ?",
                    (email_val, matricula)
                ).fetchone()
                if dup_email:
                    raise HTTPException(status_code=400, detail=f"E-mail institucional '{email_val}' já pertence ao servidor matrícula {dup_email['matricula']}.")
                updates.append("email_institucional = ?")
                params.append(email_val)
        if data.telefone_celular is not None:
            updates.append("telefone_celular = ?")
            params.append(_clean_opt(data.telefone_celular))
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
            try:
                conn.execute(f"UPDATE servidores SET {', '.join(updates)} WHERE matricula = ?", params)
            except sqlite3.IntegrityError as exc:
                msg = str(exc)
                if "login_rede" in msg:
                    raise HTTPException(status_code=400, detail="Login de rede já cadastrado para outro servidor.")
                if "email_institucional" in msg:
                    raise HTTPException(status_code=400, detail="E-mail institucional já cadastrado para outro servidor.")
                raise HTTPException(status_code=400, detail=f"Conflito de integridade ao atualizar servidor: {msg}")

        row = conn.execute("SELECT * FROM servidores WHERE matricula = ?", (matricula,)).fetchone()

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="UPDATE",
        entidade_tabela="servidores",
        registro_id=row["id"],
        detalhes={"matricula": matricula, "modificacoes": data.model_dump(exclude_unset=True)}
    )

    return _row_to_servidor_out(row)

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
