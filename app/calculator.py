from datetime import date
from typing import Dict, Any, Union

def parse_date(d: Union[str, date]) -> date:
    if isinstance(d, date):
        return d
    return date.fromisoformat(str(d).strip()[:10])

def calculate_diarias_count(dias: int, is_sede: bool = False) -> float:
    """
    Calcula a quantidade de diárias devidas conforme a legislação e especificação PF:
    - Se for lotado na sede da missão (is_sede = True): 0.0 diárias.
    - Se for 1 dia (ida e volta no mesmo dia): 0.5 diária.
    - Se for N dias (> 1): (N - 0.5) diárias (dedução regulamentar de meia-diária no retorno).
    """
    if is_sede:
        return 0.0
    if dias <= 0:
        return 0.0
    if dias == 1:
        return 0.5
    return round(float(dias) - 0.5, 1)

def compute_participant_financials(
    data_apresentacao: Union[str, date],
    data_retorno: Union[str, date],
    is_sede: bool,
    valor_diaria_unitaria: float,
    valor_passagem_aerea: float = 0.0,
    outros_custos: float = 0.0
) -> Dict[str, Any]:
    """
    Computa todos os valores numéricos e financeiros do participante na missão:
    - total de dias de participação
    - quantidade de diárias
    - valor total de diárias
    - custo total do servidor na missão
    """
    dt_inicio = parse_date(data_apresentacao)
    dt_fim = parse_date(data_retorno)

    if dt_fim < dt_inicio:
        raise ValueError("Data de retorno não pode ser anterior à data de apresentação.")

    dias = (dt_fim - dt_inicio).days + 1
    qtd_diarias = calculate_diarias_count(dias=dias, is_sede=is_sede)
    
    # Se is_sede, valor unitário não gera diárias
    valor_unit = float(valor_diaria_unitaria) if not is_sede else 0.0
    valor_total_diarias = round(qtd_diarias * valor_unit, 2)
    valor_passagem = round(float(valor_passagem_aerea or 0.0), 2)
    outros = round(float(outros_custos or 0.0), 2)
    custo_total = round(valor_total_diarias + valor_passagem + outros, 2)

    return {
        "dias_participacao": dias,
        "is_missao_sede": is_sede,
        "qtd_diarias": qtd_diarias,
        "valor_diaria_unitaria": round(valor_unit, 2),
        "valor_total_diarias": valor_total_diarias,
        "valor_passagem_aerea": valor_passagem,
        "outros_custos": outros,
        "custo_total_servidor": custo_total
    }
