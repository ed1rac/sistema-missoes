#!/usr/bin/env python
"""
SIS-MISSÕES PF - Script Principal de Execução
Inicia o servidor web uvicorn na porta 5179 por padrão.
"""
import sys
import uvicorn
from app.config import HOST, PORT

if __name__ == "__main__":
    print("=" * 70)
    print(" SIS-MISSÕES PF - Sistema de Controle de Missões e Servidores")
    print(f" Servidor iniciando em: http://localhost:{PORT}")
    print(f" Documentação da API: http://localhost:{PORT}/docs")
    print(" Usuários Mestres: 'admin' (senha 123456) | 'edkallenn' (senha 123456)")
    print("=" * 70)

    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=True,
        log_level="info"
    )
