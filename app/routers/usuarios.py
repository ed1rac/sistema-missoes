import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status, Request
from app.schemas import UserCreate, UserUpdate, UserPasswordReset, UserOut
from app.auth import get_current_user, require_admin_only, hash_password
from app.database import get_db
from app.audit import log_audit

router = APIRouter(prefix="/api/usuarios", tags=["Gestão de Usuários"])

ROLES_PERMITIDOS = {"ADMIN", "GESTOR_NAC", "CADASTRADOR", "GERENCIAL", "SERVIDOR"}

@router.get("", response_model=List[UserOut])
def list_usuarios(
    q: Optional[str] = None,
    role: Optional[str] = None,
    ativo: Optional[bool] = None,
    current_user: dict = Depends(require_admin_only)
):
    query = "SELECT id, username, full_name, email, role, ativo FROM usuarios WHERE 1=1"
    params = []

    if q:
        query += " AND (username LIKE ? OR full_name LIKE ? OR email LIKE ?)"
        term = f"%{q.strip()}%"
        params.extend([term, term, term])

    if role:
        query += " AND role = ?"
        params.append(role.upper())

    if ativo is not None:
        query += " AND ativo = ?"
        params.append(1 if ativo else 0)

    query += " ORDER BY username ASC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    return [
        UserOut(
            id=r["id"],
            username=r["username"],
            full_name=r["full_name"],
            email=r["email"],
            role=r["role"],
            ativo=bool(r["ativo"])
        )
        for r in rows
    ]

@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_usuario(data: UserCreate, request: Request, current_user: dict = Depends(require_admin_only)):
    uname = data.username.strip().lower()
    if not uname:
        raise HTTPException(status_code=400, detail="Nome de usuário (username) é obrigatório.")
    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="Senha deve possuir ao menos 4 caracteres.")

    role = data.role.upper()
    if role not in ROLES_PERMITIDOS:
        raise HTTPException(
            status_code=400,
            detail=f"Perfil '{data.role}' inválido. Valores aceitos: {', '.join(sorted(ROLES_PERMITIDOS))}"
        )

    uid = f"usr-{uuid.uuid4().hex[:10]}"
    pwhash = hash_password(data.password)

    with get_db() as conn:
        exist = conn.execute("SELECT id FROM usuarios WHERE username = ?", (uname,)).fetchone()
        if exist:
            raise HTTPException(status_code=400, detail=f"Nome de usuário '{uname}' já cadastrado.")

        conn.execute(
            """
            INSERT INTO usuarios (id, username, password_hash, full_name, email, role, ativo)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (uid, uname, pwhash, data.full_name.strip(), data.email.strip() if data.email else None, role, 1 if data.ativo else 0)
        )

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="CREATE",
        entidade_tabela="usuarios",
        registro_id=uid,
        detalhes={"username": uname, "role": role, "full_name": data.full_name}
    )

    return UserOut(
        id=uid,
        username=uname,
        full_name=data.full_name.strip(),
        email=data.email.strip() if data.email else None,
        role=role,
        ativo=data.ativo
    )

@router.get("/{id_or_username}", response_model=UserOut)
def get_usuario(id_or_username: str, current_user: dict = Depends(require_admin_only)):
    with get_db() as conn:
        r = conn.execute(
            "SELECT id, username, full_name, email, role, ativo FROM usuarios WHERE id = ? OR username = ?",
            (id_or_username, id_or_username.lower())
        ).fetchone()

    if not r:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    return UserOut(
        id=r["id"],
        username=r["username"],
        full_name=r["full_name"],
        email=r["email"],
        role=r["role"],
        ativo=bool(r["ativo"])
    )

@router.put("/{id_or_username}", response_model=UserOut)
def update_usuario(
    id_or_username: str,
    data: UserUpdate,
    request: Request,
    current_user: dict = Depends(require_admin_only)
):
    with get_db() as conn:
        u = conn.execute(
            "SELECT * FROM usuarios WHERE id = ? OR username = ?",
            (id_or_username, id_or_username.lower())
        ).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")

        # Segurança: impedir desativação do único admin
        if u["role"] == "ADMIN" and (data.ativo is False or (data.role and data.role != "ADMIN")):
            admins_count = conn.execute("SELECT COUNT(*) as cnt FROM usuarios WHERE role = 'ADMIN' AND ativo = 1").fetchone()["cnt"]
            if admins_count <= 1:
                raise HTTPException(status_code=400, detail="Não é possível desativar ou rebaixar o único Administrador ativo do sistema.")

        updates = []
        params = []

        if data.full_name is not None:
            updates.append("full_name = ?")
            params.append(data.full_name.strip())
        if data.email is not None:
            updates.append("email = ?")
            params.append(data.email.strip() if data.email else None)
        if data.role is not None:
            new_role = data.role.upper()
            if new_role not in ROLES_PERMITIDOS:
                raise HTTPException(status_code=400, detail=f"Perfil inválido: {data.role}")
            updates.append("role = ?")
            params.append(new_role)
        if data.ativo is not None:
            updates.append("ativo = ?")
            params.append(1 if data.ativo else 0)

        if updates:
            params.append(u["id"])
            conn.execute(f"UPDATE usuarios SET {', '.join(updates)} WHERE id = ?", params)

        updated = conn.execute("SELECT id, username, full_name, email, role, ativo FROM usuarios WHERE id = ?", (u["id"],)).fetchone()

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="UPDATE",
        entidade_tabela="usuarios",
        registro_id=u["id"],
        detalhes=data.model_dump(exclude_unset=True)
    )

    return UserOut(
        id=updated["id"],
        username=updated["username"],
        full_name=updated["full_name"],
        email=updated["email"],
        role=updated["role"],
        ativo=bool(updated["ativo"])
    )

@router.patch("/{id_or_username}/senha")
@router.post("/{id_or_username}/reset-password")
def reset_usuario_senha(
    id_or_username: str,
    payload: UserPasswordReset,
    request: Request,
    current_user: dict = Depends(require_admin_only)
):
    senha = payload.get_password()
    if len(senha) < 4:
        raise HTTPException(status_code=400, detail="A nova senha deve possuir ao menos 4 caracteres.")

    with get_db() as conn:
        u = conn.execute(
            "SELECT id, username FROM usuarios WHERE id = ? OR username = ?",
            (id_or_username, id_or_username.lower())
        ).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")

        pwhash = hash_password(senha)
        conn.execute("UPDATE usuarios SET password_hash = ? WHERE id = ?", (pwhash, u["id"]))

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="PASSWORD_RESET",
        entidade_tabela="usuarios",
        registro_id=u["id"],
        detalhes={"alvo_username": u["username"]}
    )

    return {"status": "ok", "message": f"Senha do usuário '{u['username']}' redefinida com sucesso."}

@router.delete("/{id_or_username}")
def delete_usuario(id_or_username: str, request: Request, current_user: dict = Depends(require_admin_only)):
    with get_db() as conn:
        u = conn.execute(
            "SELECT id, username, role FROM usuarios WHERE id = ? OR username = ?",
            (id_or_username, id_or_username.lower())
        ).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")

        if u["username"] == current_user["username"]:
            raise HTTPException(status_code=400, detail="Não é permitido excluir o usuário que está atualmente autenticado.")

        if u["role"] == "ADMIN":
            admins_count = conn.execute("SELECT COUNT(*) as cnt FROM usuarios WHERE role = 'ADMIN' AND ativo = 1").fetchone()["cnt"]
            if admins_count <= 1:
                raise HTTPException(status_code=400, detail="Não é permitido remover o único Administrador do sistema.")

        conn.execute("DELETE FROM usuarios WHERE id = ?", (u["id"],))

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="DELETE",
        entidade_tabela="usuarios",
        registro_id=u["id"],
        detalhes={"username": u["username"]}
    )

    return {"status": "ok", "message": f"Usuário '{u['username']}' removido com sucesso."}
