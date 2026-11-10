import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import PORT, HOST
from app.seed import seed_database
from app.routers import auth, servidores, missoes, config, dashboard, export, audit, usuarios

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Inicialização e auto-seed do banco de dados na primeira execução
    seed_database()
    yield

app = FastAPI(
    title="SIS-MISSÕES PF",
    description="Sistema Institucional de Gestão e Controle de Missões e Servidores da Polícia Federal",
    version="2.0.0",
    lifespan=lifespan
)

# CORS Middleware permissivo para rede local/desenvolvimento
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inclusão dos Routers de API
app.include_router(auth.router)
app.include_router(servidores.router)
app.include_router(missoes.router)
app.include_router(config.router)
app.include_router(dashboard.router)
app.include_router(export.router)
app.include_router(audit.router)
app.include_router(usuarios.router)


# Rota de Healthcheck
@app.get("/api/health", tags=["Infraestrutura"])
def healthcheck():
    return {
        "status": "healthy",
        "service": "sis-missoes-pf",
        "version": "2.0.0",
        "port": PORT
    }

# Servir Frontend Estático SPA
STATIC_DIR = Path(__file__).resolve().parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/", include_in_schema=False)
    def serve_frontend_index():
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    def catch_all_spa(full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
