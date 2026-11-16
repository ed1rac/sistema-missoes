"""
Utilitários centralizados para normalização, validação e filtragem de Status Oficiais.
Evita divergências entre SQLite (que não converte acentos em UPPER()), API REST e filtros da UI.
"""

import unicodedata
from typing import List, Optional, Tuple


OFFICIAL_STATUSES: List[str] = [
    "Indicado",
    "Pendente de Alocação",
    "SAT pendente",
    "SAT Atendida",
    "SAT Recusada",
    "SAT Reiterada",
    "OM EMITIDA",
    "PCDP CADASTRADA",
    "PCDP ENCAMINHADA",
    "PCDP PRESTAR CONTAS",
    "Concluído",
]

LEGACY_STATUSES: List[str] = [
    "RASCUNHO",
    "SOLICITADA",
    "EM_ANALISE",
    "REJEITADA",
    "APROVADA",
    "OM_EMITIDA",
    "PCDP_TRAMITADA",
    "EM_ANDAMENTO",
    "PRESTACAO_CONTAS",
    "CONCLUIDA",
    "CANCELADA",
]


def _ascii_upper_key(text: str) -> str:
    """Normaliza string para chave ASCII maiúscula sem acentos e sem underscore extra."""
    nfkd = unicodedata.normalize("NFKD", (text or "").strip())
    sem_acentos = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    return " ".join(sem_acentos.replace("_", " ").upper().split())


def _case_variants(val: str) -> List[str]:
    """Gera variantes de caixa e acentuação comuns para consulta exata via SQL IN (...)."""
    v = (val or "").strip()
    if not v:
        return []
    sqlite_upper = "".join(chr(ord(c) - 32) if "a" <= c <= "z" else c for c in v)
    nfkd = unicodedata.normalize("NFKD", v)
    ascii_only = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    candidatos = {
        v,
        v.upper(),
        v.lower(),
        v.title(),
        sqlite_upper,
        ascii_only,
        ascii_only.upper(),
        ascii_only.lower(),
    }
    return sorted(candidatos)


_OFFICIAL_BY_KEY = {_ascii_upper_key(st): st for st in OFFICIAL_STATUSES}
_OFFICIAL_BY_KEY["PENDENTE DE ALOCACAO"] = "Pendente de Alocação"
_OFFICIAL_BY_KEY["CONCLUIDO"] = "Concluído"

_LEGACY_BY_KEY = {_ascii_upper_key(st): st for st in LEGACY_STATUSES}
# Preserva chave exata com underscore para legados (ex: OM_EMITIDA -> OM_EMITIDA)
_LEGACY_EXACT = {st.upper(): st for st in LEGACY_STATUSES}


def normalize_canonical_status(raw_status: Optional[str]) -> Optional[str]:
    """
    Mapeia qualquer variação de status oficial (ou legado suportado) para sua grafia canônica.
    Preserva a capitalização oficial dos 11 status do cadastro e dos status legados usados em API/testes.
    Retorna None caso o status não seja reconhecido.
    """
    if not raw_status or not raw_status.strip():
        return None
    raw_clean = raw_status.strip()
    raw_upper = raw_clean.upper()

    # Checa match exato de legado com underscore primeiro (ex.: OM_EMITIDA, PRESTACAO_CONTAS, CONCLUIDA)
    if raw_upper in _LEGACY_EXACT:
        return _LEGACY_EXACT[raw_upper]

    key = _ascii_upper_key(raw_clean)
    if key in _OFFICIAL_BY_KEY:
        return _OFFICIAL_BY_KEY[key]
    if key in _LEGACY_BY_KEY:
        return _LEGACY_BY_KEY[key]
    return None


def is_approval_restricted_status(canonical_or_raw: str) -> bool:
    """Retorna True se o status exige permissão superior ao perfil CADASTRADOR."""
    upper = (canonical_or_raw or "").strip().upper()
    key = _ascii_upper_key(canonical_or_raw)
    restritos = {
        "APROVADA", "OM EMITIDA", "PCDP TRAMITADA", "PCDP CADASTRADA",
        "PCDP ENCAMINHADA", "PCDP PRESTAR CONTAS", "PRESTACAO CONTAS",
        "CONCLUIDA", "CONCLUIDO", "REJEITADA",
        "SAT ATENDIDA", "SAT RECUSADA",
    }
    return upper in restritos or key in restritos


CONCLUDED_STATUS_VALUES: Tuple[str, ...] = tuple(
    sorted(
        set(_case_variants("Concluído") + _case_variants("Concluída") + ["CONCLUIDA", "CONCLUIDO"])
    )
)

CANCELLED_OR_REJECTED_VALUES: Tuple[str, ...] = tuple(
    sorted(
        set(_case_variants("CANCELADA") + _case_variants("REJEITADA") + _case_variants("SAT Recusada"))
    )
)

SCDP_STAGE_VALUES: Tuple[str, ...] = tuple(
    sorted(
        set(
            _case_variants("PCDP CADASTRADA")
            + _case_variants("PCDP_CADASTRADA")
            + _case_variants("PCDP ENCAMINHADA")
            + _case_variants("PCDP_ENCAMINHADA")
            + _case_variants("PCDP_TRAMITADA")
            + _case_variants("OM EMITIDA")
            + _case_variants("OM_EMITIDA")
        )
    )
)

PRESTACAO_CONTAS_STAGE_VALUES: Tuple[str, ...] = tuple(
    sorted(
        set(
            _case_variants("PCDP PRESTAR CONTAS")
            + _case_variants("PCDP_PRESTAR_CONTAS")
            + _case_variants("PRESTACAO_CONTAS")
        )
    )
)

OM_PENDENTE_STAGE_VALUES: Tuple[str, ...] = tuple(
    sorted(
        set(
            _case_variants("APROVADA")
            + _case_variants("SAT Atendida")
            + _case_variants("SAT_ATENDIDA")
            + _case_variants("SAT pendente")
            + _case_variants("SAT Reiterada")
            + _case_variants("Indicado")
            + _case_variants("Pendente de Alocação")
        )
    )
)


def sql_in_clause(column: str, values: Tuple[str, ...]) -> Tuple[str, List[str]]:
    placeholders = ", ".join(["?"] * len(values))
    return f" AND {column} IN ({placeholders})", list(values)


def build_status_filter_clause(raw_status: str, column: str = "m.status_atual") -> Tuple[str, List[str]]:
    """
    Constrói cláusula SQL segura para filtragem por status.
    - Tokens agregados de cards do Dashboard ('CADASTRAR_SCDP', 'CADASTRO_SCDP', 'PRESTACAO_CONTAS_PENDENTE', 'OM_PENDENTE')
      filtram a etapa correspondente.
    - Qualquer um dos 11 status oficiais filtra exatamente aquele status (tolerante a caixa/acentos e legados diretos
      como Concluído <-> CONCLUIDA e OM EMITIDA <-> OM_EMITIDA).
    """
    st = (raw_status or "").strip()
    st_upper = st.upper()
    st_key = _ascii_upper_key(st)

    if st_upper in ("CADASTRO_SCDP", "CADASTRAR_SCDP"):
        return sql_in_clause(column, SCDP_STAGE_VALUES)

    if st_upper in ("PRESTACAO_CONTAS_PENDENTE", "PRESTACAO_CONTAS"):
        return sql_in_clause(column, PRESTACAO_CONTAS_STAGE_VALUES)

    if st_upper in ("OM_PENDENTE", "OM PENDENTE"):
        return sql_in_clause(column, OM_PENDENTE_STAGE_VALUES)

    if st_key in ("CONCLUIDO", "CONCLUIDA"):
        return sql_in_clause(column, CONCLUDED_STATUS_VALUES)

    if st_key == "OM EMITIDA":
        vals = tuple(sorted(set(_case_variants("OM EMITIDA") + _case_variants("OM_EMITIDA"))))
        return sql_in_clause(column, vals)

    if st_key == "PCDP CADASTRADA":
        vals = tuple(sorted(set(_case_variants("PCDP CADASTRADA") + _case_variants("PCDP_CADASTRADA"))))
        return sql_in_clause(column, vals)

    if st_key == "PCDP ENCAMINHADA":
        vals = tuple(sorted(set(_case_variants("PCDP ENCAMINHADA") + _case_variants("PCDP_ENCAMINHADA"))))
        return sql_in_clause(column, vals)

    if st_key == "PCDP PRESTAR CONTAS":
        vals = tuple(sorted(set(_case_variants("PCDP PRESTAR CONTAS") + _case_variants("PCDP_PRESTAR_CONTAS"))))
        return sql_in_clause(column, vals)

    canonical = normalize_canonical_status(st) or st
    vals = tuple(sorted(set(_case_variants(st) + _case_variants(canonical))))
    return sql_in_clause(column, vals)
