import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "app" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_DB_PATH = DATA_DIR / "missoes.db"

PORT = int(os.getenv("PORT", "5179"))
HOST = os.getenv("HOST", "0.0.0.0")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_PATH}")
DB_FILE = str(DEFAULT_DB_PATH)

JWT_SECRET = os.getenv("JWT_SECRET", "sis-missoes-super-secret-key-pf-2026-production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 horas

# Valor padrão inicial da diária federal (R$)
DEFAULT_DAILY_ALLOWANCE = float(os.getenv("DEFAULT_DAILY_ALLOWANCE", "425.00"))
