from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from app.schemas import UserLogin, TokenResponse, UserOut
from app.auth import verify_password, create_access_token, get_current_user
from app.database import get_db
from app.audit import log_audit

router = APIRouter(prefix="/api/auth", tags=["Autenticação"])

@router.post("/login", response_model=TokenResponse)
def login_json(credentials: UserLogin, request: Request):
    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username, password_hash, full_name, email, role, ativo FROM usuarios WHERE username = ?",
            (credentials.username,)
        ).fetchone()

    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Nome de usuário ou senha incorretos."
        )

    if not user["ativo"]:
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
    
    # Auditoria de login
    log_audit(
        usuario_login=user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="LOGIN",
        entidade_tabela="usuarios",
        registro_id=user["id"],
        detalhes={"msg": "Login bem-sucedido"}
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
