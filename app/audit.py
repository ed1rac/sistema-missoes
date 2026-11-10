import json
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Optional, Any
from app.database import get_db

BRT_TZ = ZoneInfo("America/Sao_Paulo")

def get_now_brt_str() -> str:
    """Retorna data/hora atual no Horário Oficial de Brasília formatada."""
    return datetime.now(BRT_TZ).strftime("%Y-%m-%d %H:%M:%S")

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
    Registra uma ocorrência imutável na trilha de auditoria (audit_logs)
    com timestamp explícito no Horário Oficial de Brasília (BRT - America/Sao_Paulo).
    """
    detalhes_str = json.dumps(detalhes, ensure_ascii=False, default=str) if detalhes else None
    agora_brt = get_now_brt_str()
    try:
        with get_db(db_path) as conn:
            conn.execute(
                """
                INSERT INTO audit_logs (timestamp, usuario_login, usuario_ip, operacao, entidade_tabela, registro_id, detalhes_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (agora_brt, usuario_login, usuario_ip, operacao, entidade_tabela, registro_id, detalhes_str)
            )
    except Exception as e:
        print(f"[AUDIT WARNING] Falha ao registrar log de auditoria: {e}")

