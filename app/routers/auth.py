from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from app.schemas import UserLogin, TokenResponse, UserOut, UserSelfPasswordChange
from app.auth import verify_password, hash_password, create_access_token, get_current_user
from app.database import get_db
from app.audit import log_audit

router = APIRouter(prefix="/api/auth", tags=["Autenticação"])

@router.post("/login", response_model=TokenResponse)
def login_json(credentials: UserLogin, request: Request):
    user_ip = request.client.host if (request and request.client) else "127.0.0.1"
    user_agent = request.headers.get("user-agent", "Desconhecido") if request else "Desconhecido"

    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username, password_hash, full_name, email, role, ativo FROM usuarios WHERE username = ?",
            (credentials.username,)
        ).fetchone()

    if not user or not verify_password(credentials.password, user["password_hash"]):
        log_audit(
            usuario_login=credentials.username,
            usuario_ip=user_ip,
            operacao="LOGIN_FAILED",
            entidade_tabela="usuarios",
            registro_id=None,
            detalhes={"motivo": "Credenciais inválidas", "user_agent": user_agent}
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nome de usuário ou senha incorretos."
        )

    if not user["ativo"]:
        log_audit(
            usuario_login=credentials.username,
            usuario_ip=user_ip,
            operacao="LOGIN_BLOCKED",
            entidade_tabela="usuarios",
            registro_id=user["id"],
            detalhes={"motivo": "Conta desativada", "user_agent": user_agent}
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Conta de usuário inativa."
        )

    user_out = UserOut(
        id=user["id"],
        username=user["username"],
        full_name=user["full_name"],
        email=user["email"],
        role=user["role"],
        ativo=bool(user["ativo"])
    )

    token = create_access_token({"sub": user["username"], "role": user["role"]})
    
    # Auditoria detalhada de logon no Horário Oficial de Brasília
    log_audit(
        usuario_login=user["username"],
        usuario_ip=user_ip,
        operacao="LOGIN",
        entidade_tabela="usuarios",
        registro_id=user["id"],
        detalhes={
            "msg": "Logon realizado com sucesso",
            "nome_completo": user["full_name"],
            "role": user["role"],
            "email": user["email"],
            "user_agent": user_agent,
            "fuso_horario": "America/Sao_Paulo (BRT)"
        }
    )

    return TokenResponse(access_token=token, token_type="bearer", user=user_out)

@router.post("/token")
def login_swagger(form_data: OAuth2PasswordRequestForm = Depends(), request: Request = None):
    # Endpoint compatível com Swagger UI OAuth2
    return login_json(UserLogin(username=form_data.username, password=form_data.password), request)

@router.get("/me", response_model=UserOut)
def get_profile(current_user: dict = Depends(get_current_user)):
    return UserOut(
        id=current_user["id"],
        username=current_user["username"],
        full_name=current_user["full_name"],
        email=current_user["email"],
        role=current_user["role"],
        ativo=bool(current_user["ativo"])
    )


@router.post("/change-password")
def change_own_password(
    payload: UserSelfPasswordChange,
    request: Request,
    current_user: dict = Depends(get_current_user)
):
    if len(payload.new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A nova senha deve possuir ao menos 6 caracteres."
        )

    with get_db() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash FROM usuarios WHERE id = ? AND ativo = 1",
            (current_user["id"],)
        ).fetchone()
        if not row or not verify_password(payload.current_password, row["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Senha atual incorreta."
            )
        if verify_password(payload.new_password, row["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A nova senha deve ser diferente da senha atual."
            )

        conn.execute(
            "UPDATE usuarios SET password_hash = ? WHERE id = ?",
            (hash_password(payload.new_password), row["id"])
        )

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if (request and request.client) else "127.0.0.1",
        operacao="PASSWORD_CHANGE",
        entidade_tabela="usuarios",
        registro_id=current_user["id"],
        detalhes={"username": current_user["username"]}
    )

    return {"status": "ok", "message": "Senha alterada com sucesso."}
