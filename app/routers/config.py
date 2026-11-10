from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from app.schemas import ConfigItem, ConfigUpdate
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.audit import log_audit

router = APIRouter(prefix="/api/config", tags=["Configurações do Sistema"])

@router.get("", response_model=List[ConfigItem])
def list_configs(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT chave, valor, descricao FROM configuracoes ORDER BY chave ASC").fetchall()
    return [ConfigItem(chave=r["chave"], valor=r["valor"], descricao=r["descricao"]) for r in rows]

@router.get("/{chave}", response_model=ConfigItem)
def get_config(chave: str, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        r = conn.execute("SELECT chave, valor, descricao FROM configuracoes WHERE chave = ?", (chave,)).fetchone()
    if not r:
        raise HTTPException(status_code=404, detail="Configuração não encontrada.")
    return ConfigItem(chave=r["chave"], valor=r["valor"], descricao=r["descricao"])

@router.put("/{chave}", response_model=ConfigItem)
def update_config(chave: str, data: ConfigUpdate, request: Request, current_user: dict = Depends(require_admin)):
    with get_db() as conn:
        existing = conn.execute("SELECT chave, valor FROM configuracoes WHERE chave = ?", (chave,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Configuração não encontrada.")

        conn.execute(
            "UPDATE configuracoes SET valor = ?, descricao = COALESCE(?, descricao), updated_at = CURRENT_TIMESTAMP WHERE chave = ?",
            (data.valor, data.descricao, chave)
        )
        row = conn.execute("SELECT chave, valor, descricao FROM configuracoes WHERE chave = ?", (chave,)).fetchone()

    log_audit(
        usuario_login=current_user["username"],
        usuario_ip=request.client.host if request.client else "127.0.0.1",
        operacao="UPDATE_CONFIG",
        entidade_tabela="configuracoes",
        registro_id=chave,
        detalhes={"valor_anterior": existing["valor"], "novo_valor": data.valor}
    )

    return ConfigItem(chave=row["chave"], valor=row["valor"], descricao=row["descricao"])
