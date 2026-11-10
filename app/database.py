import sqlite3
import json
from contextlib import contextmanager
from typing import Generator
from app.config import DB_FILE

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'SERVIDOR', -- ADMIN, GESTOR_NAC, GESTOR_UNID, SERVIDOR
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    descricao TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS valores_diarias (
    id TEXT PRIMARY KEY,
    categoria TEXT UNIQUE NOT NULL, -- INTERIOR, CAPITAIS, CAPITAIS_ESPECIAIS
    descricao TEXT NOT NULL,
    valor REAL NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orgao_unidades (
    id TEXT PRIMARY KEY,
    sigla TEXT UNIQUE NOT NULL,
    nome_extenso TEXT NOT NULL,
    municipio TEXT NOT NULL,
    uf TEXT NOT NULL,
    is_fronteira INTEGER NOT NULL DEFAULT 0,
    valor_diaria REAL NOT NULL DEFAULT 380.00,
    categoria_diaria TEXT NOT NULL DEFAULT 'CAPITAIS',
    tipo_unidade TEXT NOT NULL DEFAULT 'CAPITAL',
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS setores_destino (
    id TEXT PRIMARY KEY,
    sigla TEXT UNIQUE NOT NULL,
    nome TEXT NOT NULL,
    unidade_pai_sigla TEXT NOT NULL DEFAULT 'SR/PF/PB',
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cargos (
    id TEXT PRIMARY KEY,
    sigla TEXT UNIQUE NOT NULL, -- DPF, EPF, APF, PPF, PCF, ADM
    descricao TEXT NOT NULL,
    is_carreira_policial INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS servidores (
    id TEXT PRIMARY KEY,
    matricula TEXT UNIQUE NOT NULL,
    nome_completo TEXT NOT NULL,
    nome_guerra TEXT,
    cargo_sigla TEXT NOT NULL,
    unidade_sigla TEXT NOT NULL,
    login_rede TEXT UNIQUE,
    email_institucional TEXT UNIQUE NOT NULL,
    telefone_celular TEXT,
    tpe INTEGER NOT NULL DEFAULT 0, -- 1 se tiver TPE (Treinamento Pedagógico)
    is_missionario_geral INTEGER NOT NULL DEFAULT 1, -- 1 com diárias, 0 local/sem diárias
    observacoes_gerais TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tipos_missao (
    id TEXT PRIMARY KEY,
    nome TEXT UNIQUE NOT NULL,
    descricao TEXT,
    ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS papeis_missao (
    id TEXT PRIMARY KEY,
    nome TEXT UNIQUE NOT NULL,
    descricao TEXT
);

CREATE TABLE IF NOT EXISTS missoes (
    id TEXT PRIMARY KEY,
    codigo_missao TEXT UNIQUE NOT NULL, -- ex: MIS-2026-00101
    titulo TEXT NOT NULL,
    justificativa TEXT NOT NULL,
    tipo_missao TEXT NOT NULL,
    unidade_solicitante TEXT NOT NULL,
    unidade_destino TEXT,
    setor_destino TEXT,
    localidade_descricao TEXT NOT NULL,
    data_inicio TEXT NOT NULL,
    data_termino TEXT NOT NULL,
    total_dias INTEGER NOT NULL,
    responsavel_matricula TEXT,
    missionario_matricula TEXT REFERENCES servidores(matricula),
    modalidade TEXT NOT NULL DEFAULT 'INDIVIDUAL', -- 'INDIVIDUAL' ou 'EQUIPE'
    status_atual TEXT NOT NULL DEFAULT 'RASCUNHO',
    meio_transporte TEXT NOT NULL DEFAULT 'AEREO', -- AEREO, TERRESTRE, PROPRIO
    custo_estimado_passagens REAL NOT NULL DEFAULT 0.0,
    numero_sat TEXT,
    numero_om TEXT,
    numero_pcdp TEXT,
    processo_sei TEXT,
    valor_diaria_padrao REAL NOT NULL DEFAULT 425.00, -- CAMPO EDITÁVEL DA MISSÃO
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS missoes_participantes (
    id TEXT PRIMARY KEY,
    missao_id TEXT NOT NULL REFERENCES missoes(id) ON DELETE CASCADE,
    servidor_matricula TEXT NOT NULL REFERENCES servidores(matricula) ON DELETE RESTRICT,
    papel TEXT NOT NULL,
    meio_transporte TEXT NOT NULL DEFAULT 'AEREO', -- AEREO, VIATURA_OFICIAL, FLUVIAL, MISTO, OUTRO
    data_apresentacao TEXT NOT NULL,
    data_retorno TEXT NOT NULL,
    dias_participacao INTEGER NOT NULL,
    is_missao_sede INTEGER NOT NULL DEFAULT 0,
    qtd_diarias REAL NOT NULL DEFAULT 0.0,
    valor_diaria_unitaria REAL NOT NULL DEFAULT 425.00, -- CAMPO EDITÁVEL DO PARTICIPANTE
    valor_total_diarias REAL NOT NULL DEFAULT 0.0,
    valor_passagem_aerea REAL NOT NULL DEFAULT 0.0,
    outros_custos REAL NOT NULL DEFAULT 0.0,
    custo_total_servidor REAL NOT NULL DEFAULT 0.0,
    localizador_aereo TEXT,
    numero_eticket TEXT,
    observacoes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(missao_id, servidor_matricula, data_apresentacao)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    usuario_login TEXT NOT NULL,
    usuario_ip TEXT NOT NULL,
    operacao TEXT NOT NULL, -- CREATE, UPDATE, DELETE, STATUS_CHANGE, LOGIN, EXPORT
    entidade_tabela TEXT NOT NULL,
    registro_id TEXT,
    detalhes_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_servidores_matricula ON servidores(matricula);
CREATE INDEX IF NOT EXISTS idx_servidores_nome ON servidores(nome_completo);
CREATE INDEX IF NOT EXISTS idx_missoes_codigo ON missoes(codigo_missao);
CREATE INDEX IF NOT EXISTS idx_missoes_status ON missoes(status_atual);
CREATE INDEX IF NOT EXISTS idx_missoes_periodo ON missoes(data_inicio, data_termino);
CREATE INDEX IF NOT EXISTS idx_missoes_modalidade ON missoes(modalidade);
CREATE INDEX IF NOT EXISTS idx_missoes_setor ON missoes(setor_destino);
CREATE INDEX IF NOT EXISTS idx_missoes_transporte ON missoes(meio_transporte);
CREATE INDEX IF NOT EXISTS idx_participantes_missao ON missoes_participantes(missao_id);
CREATE INDEX IF NOT EXISTS idx_participantes_servidor ON missoes_participantes(servidor_matricula);
CREATE INDEX IF NOT EXISTS idx_setores_sigla ON setores_destino(sigla);
CREATE INDEX IF NOT EXISTS idx_setores_unidade_pai ON setores_destino(unidade_pai_sigla);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
"""

@contextmanager
def get_db(db_path: str = None) -> Generator[sqlite3.Connection, None, None]:
    target = db_path or DB_FILE
    conn = sqlite3.connect(target, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db(db_path: str = None):
    with get_db(db_path) as conn:
        # Migração idempotente para colunas novas em bases pré-existentes
        try:
            tbl_check = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='missoes'").fetchone()
            if tbl_check:
                cols = [r["name"] for r in conn.execute("PRAGMA table_info(missoes)").fetchall()]
                if "missionario_matricula" not in cols:
                    conn.execute("ALTER TABLE missoes ADD COLUMN missionario_matricula TEXT REFERENCES servidores(matricula);")
                if "modalidade" not in cols:
                    conn.execute("ALTER TABLE missoes ADD COLUMN modalidade TEXT NOT NULL DEFAULT 'INDIVIDUAL';")
                if "setor_destino" not in cols:
                    conn.execute("ALTER TABLE missoes ADD COLUMN setor_destino TEXT;")
                if "meio_transporte" not in cols:
                    conn.execute("ALTER TABLE missoes ADD COLUMN meio_transporte TEXT NOT NULL DEFAULT 'AEREO';")
                if "custo_estimado_passagens" not in cols:
                    conn.execute("ALTER TABLE missoes ADD COLUMN custo_estimado_passagens REAL NOT NULL DEFAULT 0.0;")

            unid_check = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='orgao_unidades'").fetchone()
            if unid_check:
                u_cols = [r["name"] for r in conn.execute("PRAGMA table_info(orgao_unidades)").fetchall()]
                if "valor_diaria" not in u_cols:
                    conn.execute("ALTER TABLE orgao_unidades ADD COLUMN valor_diaria REAL NOT NULL DEFAULT 380.00;")
                if "categoria_diaria" not in u_cols:
                    conn.execute("ALTER TABLE orgao_unidades ADD COLUMN categoria_diaria TEXT NOT NULL DEFAULT 'CAPITAIS';")
                if "tipo_unidade" not in u_cols:
                    conn.execute("ALTER TABLE orgao_unidades ADD COLUMN tipo_unidade TEXT NOT NULL DEFAULT 'CAPITAL';")
        except Exception as e:
            print(f"[DB PRE-MIGRATION WARNING] {e}")

        conn.executescript(SCHEMA_SQL)

