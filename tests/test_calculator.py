import pytest
from app.calculator import calculate_diarias_count, compute_participant_financials

def test_diarias_count_multi_days():
    """Para N dias (>1), dedução de meia-diária no retorno: (N - 0.5)"""
    assert calculate_diarias_count(10, is_sede=False) == 9.5
    assert calculate_diarias_count(22, is_sede=False) == 21.5
    assert calculate_diarias_count(2, is_sede=False) == 1.5

def test_diarias_count_single_day():
    """Para 1 dia (ida e retorno no mesmo dia), paga-se 0.5 diária"""
    assert calculate_diarias_count(1, is_sede=False) == 0.5

def test_diarias_count_is_sede_exemption():
    """Servidor lotado na sede da missão não tem direito a diárias (0.0)"""
    assert calculate_diarias_count(10, is_sede=True) == 0.0
    assert calculate_diarias_count(22, is_sede=True) == 0.0
    assert calculate_diarias_count(1, is_sede=True) == 0.0

def test_compute_participant_financials_regular():
    """Cálculo financeiro completo para servidor em viagem"""
    res = compute_participant_financials(
        data_apresentacao="2026-06-01",
        data_retorno="2026-06-10",
        is_sede=False,
        valor_diaria_unitaria=425.00,
        valor_passagem_aerea=1500.00,
        outros_custos=100.00
    )
    assert res["dias_participacao"] == 10
    assert res["qtd_diarias"] == 9.5
    assert res["valor_total_diarias"] == 4037.50  # 9.5 * 425.00
    assert res["valor_passagem_aerea"] == 1500.00
    assert res["outros_custos"] == 100.00
    assert res["custo_total_servidor"] == 5637.50

def test_compute_participant_financials_sede():
    """Servidor na sede da missão deve ter diárias zeradas"""
    res = compute_participant_financials(
        data_apresentacao="2026-06-01",
        data_retorno="2026-06-10",
        is_sede=True,
        valor_diaria_unitaria=425.00,
        valor_passagem_aerea=0.0
    )
    assert res["dias_participacao"] == 10
    assert res["qtd_diarias"] == 0.0
    assert res["valor_total_diarias"] == 0.0
    assert res["custo_total_servidor"] == 0.0

def test_compute_participant_financials_invalid_dates():
    """Retorno anterior à apresentação deve disparar ValueError"""
    with pytest.raises(ValueError):
        compute_participant_financials(
            data_apresentacao="2026-06-10",
            data_retorno="2026-06-05",
            is_sede=False,
            valor_diaria_unitaria=425.00
        )
