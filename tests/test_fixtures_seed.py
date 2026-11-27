"""
Massa de dados exclusiva para a suíte de testes automatizados.
Não é utilizada em produção (o banco oficial inicia saneado sem dados fictícios).
"""

from app.database import get_db
from app.calculator import compute_participant_financials, parse_date


def _seed_missao_teste(
    conn,
    mid: str,
    codigo: str,
    titulo: str,
    justificativa: str,
    tipo: str,
    solicitante: str,
    destino: str,
    localidade: str,
    dt_inicio: str,
    dt_fim: str,
    responsavel_mat: str,
    status: str,
    modalidade: str = "INDIVIDUAL",
    missionario_mat: str = None,
    valor_diaria: float = 425.00,
    setor_destino: str = None,
    meio_transporte: str = "AEREO",
    custo_estimado_passagens: float = 0.0,
    om: str = None,
    pcdp: str = None,
    sat: str = None,
    sei: str = None,
    obs: str = None,
    participantes: list = None,
):
    d1 = parse_date(dt_inicio)
    d2 = parse_date(dt_fim)
    total_dias = (d2 - d1).days + 1

    conn.execute(
        """
        INSERT INTO missoes (
            id, codigo_missao, titulo, justificativa, tipo_missao, unidade_solicitante,
            unidade_destino, setor_destino, localidade_descricao, data_inicio, data_termino, total_dias,
            responsavel_matricula, missionario_matricula, modalidade, status_atual,
            meio_transporte, custo_estimado_passagens, numero_sat, numero_om, numero_pcdp,
            processo_sei, valor_diaria_padrao, observacoes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(codigo_missao) DO NOTHING
        """,
        (
            mid, codigo, titulo, justificativa, tipo, solicitante, destino, setor_destino, localidade,
            dt_inicio, dt_fim, total_dias, responsavel_mat, missionario_mat, modalidade,
            status, meio_transporte, custo_estimado_passagens, sat, om, pcdp, sei, valor_diaria, obs,
        ),
    )

    if participantes:
        for idx, p in enumerate(participantes):
            pid = f"{mid}-p{idx+1}"
            mat = p["matricula"]
            p_inicio = p.get("inicio", dt_inicio)
            p_fim = p.get("fim", dt_fim)
            is_sede = p.get("is_sede", False)
            v_diaria = p.get("valor_diaria", valor_diaria)
            v_passagem = p.get("passagem", 0.0)
            meio = p.get("transporte", meio_transporte)
            papel = p.get("papel", "Operador Tático")
            p_obs = p.get("obs", "")

            fin = compute_participant_financials(
                data_apresentacao=p_inicio,
                data_retorno=p_fim,
                is_sede=is_sede,
                valor_diaria_unitaria=v_diaria,
                valor_passagem_aerea=v_passagem,
            )
            conn.execute(
                """
                INSERT INTO missoes_participantes (
                    id, missao_id, servidor_matricula, papel, meio_transporte, data_apresentacao,
                    data_retorno, dias_participacao, is_missao_sede, qtd_diarias, valor_diaria_unitaria,
                    valor_total_diarias, valor_passagem_aerea, outros_custos, custo_total_servidor,
                    observacoes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(missao_id, servidor_matricula, data_apresentacao) DO NOTHING
                """,
                (
                    pid, mid, mat, papel, meio, p_inicio, p_fim, fin["dias_participacao"],
                    1 if is_sede else 0, fin["qtd_diarias"], fin["valor_diaria_unitaria"],
                    fin["valor_total_diarias"], fin["valor_passagem_aerea"], 0.0,
                    fin["custo_total_servidor"], p_obs,
                ),
            )
    elif modalidade == "INDIVIDUAL" and missionario_mat:
        pid = f"{mid}-p1"
        v_passagem = custo_estimado_passagens if meio_transporte == "AEREO" else 0.0
        fin = compute_participant_financials(
            data_apresentacao=dt_inicio,
            data_retorno=dt_fim,
            is_sede=False,
            valor_diaria_unitaria=valor_diaria,
            valor_passagem_aerea=v_passagem,
        )
        conn.execute(
            """
            INSERT INTO missoes_participantes (
                id, missao_id, servidor_matricula, papel, meio_transporte, data_apresentacao,
                data_retorno, dias_participacao, is_missao_sede, qtd_diarias, valor_diaria_unitaria,
                valor_total_diarias, valor_passagem_aerea, outros_custos, custo_total_servidor,
                observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(missao_id, servidor_matricula, data_apresentacao) DO NOTHING
            """,
            (
                pid, mid, missionario_mat, "Missionário Individual", meio_transporte,
                dt_inicio, dt_fim, fin["dias_participacao"], 0, fin["qtd_diarias"],
                fin["valor_diaria_unitaria"], fin["valor_total_diarias"], fin["valor_passagem_aerea"], 0.0,
                fin["custo_total_servidor"], "Missão individual designada",
            ),
        )


def seed_test_fixtures(db_path: str):
    """Popula servidores e missões sintéticas somente no banco temporário de testes."""
    with get_db(db_path) as conn:
        servidores_data = [
            ("srv-01", "10293", "ALEXANDRE SILVEIRA MENDES", "SILVEIRA", "111.222.333-01", "DPF", "DPF/CAS/PR", "silveira.asm", "silveira.asm@pf.gov.br", "(45) 99123-4567", 1, 1, "Especialista em Técnicas de Investigação"),
            ("srv-02", "14582", "BEATRIZ ALENCAR ROCHA", "BEATRIZ", "111.222.333-02", "EPF", "SR/PF/AM", "rocha.bar", "rocha.bar@pf.gov.br", "(92) 98456-7890", 1, 1, "Apoio cartorário operacional e instrução disciplinar"),
            ("srv-03", "19874", "CARLOS EDUARDO BRAGANCA", "BRAGANCA", "111.222.333-03", "APF", "SR/PF/DF", "braganca.ceb", "braganca.ceb@pf.gov.br", "(61) 99876-5432", 1, 0, "Lotado em Brasília/DF. Não gera diárias em missões no DF."),
            ("srv-04", "12459", "DANIELA FONTES MONTEIRO", "MONTEIRO", "111.222.333-04", "PCF", "DITEC/PF", "monteiro.dfm", "monteiro.dfm@pf.gov.br", "(61) 98765-4321", 0, 1, "Perita em Balística Forense. Missões periciais de campo."),
            ("srv-05", "21034", "EDUARDO MARTINS COSTA", "COSTA", "111.222.333-05", "PPF", "DPF/CAS/PR", "costa.emc", "costa.emc@pf.gov.br", "(45) 99345-6789", 0, 1, "Papiloscopista de campo. Perícia necropapiloscópica."),
            ("srv-06", "33412", "FRANCISCO DE ASSIS PEREIRA", "ASSIS", "111.222.333-06", "DPF", "SR/PF/PB", "assis.fap", "assis.fap@pf.gov.br", "(83) 98877-1122", 1, 1, "Delegado Regional Executivo na Paraíba"),
            ("srv-07", "35891", "MARIA CLARA CAVALCANTI", "CLARA", "111.222.333-07", "EPF", "CGE/PF/PB", "cavalcanti.mcc", "cavalcanti.mcc@pf.gov.br", "(83) 98765-3344", 1, 1, "Chefe de Cartório em Campina Grande/PB"),
            ("srv-08", "38104", "JOSE TAVARES SOBRINHO", "TAVARES", "111.222.333-08", "APF", "PAT/PF/PB", "tavares.jts", "tavares.jts@pf.gov.br", "(83) 99123-5566", 1, 1, "Agente operacional experiente no sertão paraibano"),
            ("srv-09", "41205", "ANA BEATRIZ NOGUEIRA", "NOGUEIRA", "111.222.333-09", "PCF", "SR/PF/PB", "nogueira.abn", "nogueira.abn@pf.gov.br", "(83) 99345-7788", 0, 1, "Perita Criminal Federal da SR/PB"),
            ("srv-10", "43719", "LUCAS MARANHAO GOMES", "MARANHAO", "111.222.333-10", "PPF", "CGE/PF/PB", "gomes.lmg", "gomes.lmg@pf.gov.br", "(83) 98112-9900", 0, 1, "Papiloscopista de campo em Campina Grande/PB"),
        ]
        for sid, mat, nome, nguerra, cpf, cargo, unid, login, mail, fone, tpe, miss_geral, obs in servidores_data:
            conn.execute(
                """
                INSERT INTO servidores (
                    id, matricula, nome_completo, nome_guerra, cpf, cargo_sigla, unidade_sigla,
                    login_rede, email_institucional, telefone_celular, tpe, is_missionario_geral,
                    observacoes_gerais, ativo
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(matricula) DO NOTHING
                """,
                (sid, mat, nome, nguerra, cpf, cargo, unid, login, mail, fone, tpe, miss_geral, obs),
            )

        _seed_missao_teste(
            conn, mid="mis-01", codigo="MIS-2026-00101",
            titulo="Instrução do Curso de Formação Profissional - CFP 2026",
            justificativa="Convocação de instrutores para ministrar disciplinas no CFP/2026.",
            tipo="Ensino e Capacitação", solicitante="SR/PF/DF", destino="SR/PF/DF",
            localidade="Brasília/DF", dt_inicio="2026-05-25", dt_fim="2026-06-15",
            responsavel_mat="10293", status="OM_EMITIDA", modalidade="EQUIPE",
            valor_diaria=425.00, om="OM-2026-0158", pcdp="PCDP-004120/26", sat="SAT-2026-00412",
            sei="08200.001234/2026-11", obs="Missão autorizada pela Direção Geral.",
            participantes=[
                {"matricula": "10293", "papel": "Professor Coordenador", "transporte": "AEREO", "inicio": "2026-05-25", "fim": "2026-06-15", "is_sede": False, "valor_diaria": 425.00, "passagem": 1650.00},
                {"matricula": "19874", "papel": "Instrutor de Armamento e Tiro", "transporte": "VIATURA_OFICIAL", "inicio": "2026-05-25", "fim": "2026-06-15", "is_sede": True, "valor_diaria": 425.00, "passagem": 0.0},
            ],
        )

        _seed_missao_teste(
            conn, mid="mis-02", codigo="MIS-2026-00102",
            titulo="Operação Sentinela - Reforço de Fronteira",
            justificativa="Fiscalização e patrulhamento em postos de fronteira no Paraná.",
            tipo="Operacional / Repressão", solicitante="DPF/CAS/PR", destino="DPF/CAS/PR",
            localidade="Foz do Iguaçu e Guaíra/PR", dt_inicio="2026-06-01", dt_fim="2026-06-12",
            responsavel_mat="10293", status="APROVADA", modalidade="EQUIPE",
            valor_diaria=425.00, om="OM-2026-0210", pcdp="PCDP-005881/26", sat="SAT-2026-00588",
            sei="08200.005544/2026-44", obs="Apoio aéreo e terrestre",
            participantes=[
                {"matricula": "21034", "papel": "Operador Tático", "transporte": "AEREO", "inicio": "2026-06-01", "fim": "2026-06-12", "is_sede": False, "valor_diaria": 425.00, "passagem": 1200.00},
            ],
        )

        _seed_missao_teste(
            conn, mid="mis-03", codigo="MIS-2026-00103",
            titulo="Perícia Integrada em Local de Desastre Ambiental",
            justificativa="Atuação conjunta de peritos criminais federais em sinistro ambiental.",
            tipo="Perícia Oficial", solicitante="DITEC/PF", destino="SR/PF/AM",
            localidade="Humaitá e Manicoré/AM", dt_inicio="2026-07-10", dt_fim="2026-07-20",
            responsavel_mat="12459", status="SOLICITADA", modalidade="EQUIPE",
            valor_diaria=450.00, om=None, pcdp=None, sat="SAT-2026-00910",
            sei="08200.008899/2026-72", obs="Diária diferenciada para área remota amazônica (R$ 450,00).",
            participantes=[
                {"matricula": "12459", "papel": "Perito de Campo", "transporte": "AEREO", "inicio": "2026-07-10", "fim": "2026-07-20", "is_sede": False, "valor_diaria": 450.00, "passagem": 2100.00},
            ],
        )

        missoes_2026 = [
            {
                "mid": "mis-2026-01", "codigo": "MIS-2026-00010",
                "titulo": "Operação Verão Litoral Paraibano",
                "justificativa": "Reforço no patrulhamento marítimo e repressão ao tráfico de entorpecentes no litoral da PB.",
                "tipo": "Operacional / Repressão", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB", "setor": "NEPOM",
                "localidade": "João Pessoa e Cabedelo/PB", "inicio": "2026-01-05", "fim": "2026-01-16",
                "resp": "33412", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 380.00,
                "transporte": "AEREO", "custo_passagem": 1450.00,
                "sat": "SAT-2026-00012", "om": "OM-2026-0005", "pcdp": "PCDP-000101/26",
                "parts": [
                    {"matricula": "38104", "papel": "Operador Tático", "transporte": "AEREO", "is_sede": False, "passagem": 1450.00},
                    {"matricula": "43719", "papel": "Apoio Técnico", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0},
                ],
            },
            {
                "mid": "mis-2026-24", "codigo": "MIS-2026-00115",
                "titulo": "Diligência Postal - Combate a Remessa Ilícita de Drogas",
                "justificativa": "Inspeção e apreensão de encomendas em centro de triagem dos Correios.",
                "tipo": "Inteligência e Investigação", "solicitante": "DPF/CGE/PB", "destino": "SR/PF/PB", "setor": "DRE",
                "localidade": "Campina Grande/PB", "inicio": "2026-11-09", "fim": "2026-11-19",
                "resp": "35891", "miss": "38104", "modalidade": "INDIVIDUAL", "status": "PCDP ENCAMINHADA", "diaria": 380.00,
                "transporte": "AEREO", "custo_passagem": 1300.00,
                "sat": "SAT-2026-00375", "om": "OM-2026-0352", "pcdp": "PCDP-001102/26",
            },
            {
                "mid": "mis-2026-26", "codigo": "MIS-2026-00124",
                "titulo": "Operação Fim de Ano Seguro Paraíba",
                "justificativa": "Reforço no patrulhamento em terminais rodoviários e portuários de Cabedelo.",
                "tipo": "Operacional / Repressão", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB", "setor": "GPI",
                "localidade": "João Pessoa e Cabedelo/PB", "inicio": "2026-12-07", "fim": "2026-12-22",
                "resp": "33412", "miss": None, "modalidade": "EQUIPE", "status": "OM EMITIDA", "diaria": 380.00,
                "transporte": "AEREO", "custo_passagem": 1500.00,
                "sat": "SAT-2026-00410", "om": "OM-2026-0388", "pcdp": "PCDP-001201/26",
                "parts": [
                    {"matricula": "38104", "papel": "Operador Tático", "transporte": "AEREO", "is_sede": False, "passagem": 1500.00},
                ],
            },
        ]

        for mdata in missoes_2026:
            _seed_missao_teste(
                conn,
                mid=mdata["mid"],
                codigo=mdata["codigo"],
                titulo=mdata["titulo"],
                justificativa=mdata["justificativa"],
                tipo=mdata["tipo"],
                solicitante=mdata["solicitante"],
                destino=mdata["destino"],
                setor_destino=mdata.get("setor"),
                localidade=mdata["localidade"],
                dt_inicio=mdata["inicio"],
                dt_fim=mdata["fim"],
                responsavel_mat=mdata["resp"],
                missionario_mat=mdata.get("miss"),
                modalidade=mdata.get("modalidade", "INDIVIDUAL"),
                status=mdata["status"],
                meio_transporte=mdata.get("transporte", "AEREO"),
                custo_estimado_passagens=mdata.get("custo_passagem", 0.0),
                valor_diaria=mdata.get("diaria", 380.00),
                sat=mdata.get("sat"),
                om=mdata.get("om"),
                pcdp=mdata.get("pcdp"),
                participantes=mdata.get("parts"),
            )
