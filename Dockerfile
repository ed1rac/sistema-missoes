# ==============================================================================
# Sistema de Controle de Diárias e Passagens - Dockerfile Oficial (Python 3.13-slim)
# ==============================================================================
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=5179 \
    HOST=0.0.0.0 \
    UVICORN_RELOAD=false \
    TZ=America/Sao_Paulo

WORKDIR /app

# Instalação de dependências de sistema para compilação eventual
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código-fonte da aplicação
COPY . .

# Criar pasta de dados para volume SQLite persistente
RUN mkdir -p /app/app/data

EXPOSE 5179

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:5179/api/health || exit 1

CMD ["python", "run.py"]
