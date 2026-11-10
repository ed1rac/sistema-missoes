import json
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, Query
from app.auth import require_audit_view
from app.database import get_db

router = APIRouter(prefix="/api/audit", tags=["Trilha de Auditoria"])

@router.get("/logs")
def list_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    operacao: Optional[str] = None,
    entidade: Optional[str] = None,
    usuario: Optional[str] = None,
    data_de: Optional[str] = None,
    data_ate: Optional[str] = None,
    current_user: dict = Depends(require_audit_view)
):
    query = "SELECT * FROM audit_logs WHERE 1=1"
    params = []

    if operacao:
        query += " AND operacao = ?"
        params.append(operacao)
    if entidade:
        query += " AND entidade_tabela = ?"
        params.append(entidade)
    if usuario:
        query += " AND usuario_login = ?"
        params.append(usuario)
    if data_de:
        query += " AND timestamp >= ?"
        params.append(data_de)
    if data_ate:
        query += " AND timestamp <= ?"
        params.append(data_ate + " 23:59:59" if len(data_ate) == 10 else data_ate)

    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)


    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    results = []
    for r in rows:
        d = dict(r)
        if d.get("detalhes_json"):
            try:
                d["detalhes"] = json.loads(d["detalhes_json"])
            except Exception:
                d["detalhes"] = d["detalhes_json"]
        results.append(d)

    return results
