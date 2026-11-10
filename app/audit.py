import json
from typing import Optional, Any
from app.database import get_db

def log_audit(
    usuario_login: str,
    usuario_ip: str,
    operacao: str,
    entidade_tabela: str,
    registro_id: Optional[str] = None,
    detalhes: Optional[Any] = None,
    db_path: Optional[str] = None
):
    """
    Registra uma ocorrência imutável na trilha de auditoria (audit_logs).
    """
    detalhes_str = json.dumps(detalhes, ensure_ascii=False, default=str) if detalhes else None
    try:
        with get_db(db_path) as conn:
            conn.execute(
                """
                INSERT INTO audit_logs (usuario_login, usuario_ip, operacao, entidade_tabela, registro_id, detalhes_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (usuario_login, usuario_ip, operacao, entidade_tabela, registro_id, detalhes_str)
            )
    except Exception as e:
        print(f"[AUDIT WARNING] Falha ao registrar log de auditoria: {e}")
