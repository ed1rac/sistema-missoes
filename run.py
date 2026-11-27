#!/usr/bin/env python
"""
Sistema de Controle de Diárias e Passagens - Script Principal de Execução
Inicia o servidor web uvicorn na porta 5179 por padrão.
"""
import os
import uvicorn
from app.config import HOST, PORT

if __name__ == "__main__":
    reload_enabled = os.getenv("UVICORN_RELOAD", "false").strip().lower() in ("1", "true", "yes", "on")

    print("=" * 70)
    print(" Sistema de Controle de Diárias e Passagens - Polícia Federal")
    print(f" Servidor iniciando em: http://localhost:{PORT} (reload={reload_enabled})")
    print(f" Documentação da API: http://localhost:{PORT}/docs")
    print(" Consulte o README.md para credenciais iniciais e altere as senhas após o deploy.")
    print("=" * 70)

    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=reload_enabled,
        log_level="info"
    )
