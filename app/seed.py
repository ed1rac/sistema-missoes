import uuid
from app.database import get_db, init_db
from app.auth import hash_password
from app.calculator import compute_participant_financials, parse_date
from app.config import DEFAULT_DAILY_ALLOWANCE

def _seed_missao(
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
    modalidade: str = "EQUIPE",
    missionario_mat: str = None,
    valor_diaria: float = 425.00,
    om: str = None,
    pcdp: str = None,
    sat: str = None,
    sei: str = None,
    obs: str = None,
    participantes: list = None
):
    d1 = parse_date(dt_inicio)
    d2 = parse_date(dt_fim)
    total_dias = (d2 - d1).days + 1

    conn.execute(
        """
        INSERT INTO missoes (
            id, codigo_missao, titulo, justificativa, tipo_missao, unidade_solicitante,
            unidade_destino, localidade_descricao, data_inicio, data_termino, total_dias,
            responsavel_matricula, missionario_matricula, modalidade, status_atual, numero_sat, numero_om, numero_pcdp,
            processo_sei, valor_diaria_padrao, observacoes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(codigo_missao) DO UPDATE SET
            missionario_matricula=excluded.missionario_matricula,
            modalidade=excluded.modalidade
        """,
        (
            mid, codigo, titulo, justificativa, tipo, solicitante, destino, localidade,
            dt_inicio, dt_fim, total_dias, responsavel_mat, missionario_mat, modalidade,
            status, sat, om, pcdp, sei, valor_diaria, obs
        )
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
            meio = p.get("transporte", "AEREO")
            papel = p.get("papel", "Operador Tático")
            p_obs = p.get("obs", "")

            fin = compute_participant_financials(
                data_apresentacao=p_inicio,
                data_retorno=p_fim,
                is_sede=is_sede,
                valor_diaria_unitaria=v_diaria,
                valor_passagem_aerea=v_passagem
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
                    fin["custo_total_servidor"], p_obs
                )
            )
    elif modalidade == "INDIVIDUAL" and missionario_mat:
        pid = f"{mid}-p1"
        fin = compute_participant_financials(
            data_apresentacao=dt_inicio,
            data_retorno=dt_fim,
            is_sede=False,
            valor_diaria_unitaria=valor_diaria,
            valor_passagem_aerea=0.0
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
                pid, mid, missionario_mat, "Missionário Individual", "VIATURA_OFICIAL",
                dt_inicio, dt_fim, fin["dias_participacao"], 0, fin["qtd_diarias"],
                fin["valor_diaria_unitaria"], fin["valor_total_diarias"], 0.0, 0.0,
                fin["custo_total_servidor"], "Missão individual designada"
            )
        )

def seed_database(db_path: str = None):
    init_db(db_path)
    with get_db(db_path) as conn:
        # 1. Usuários do Sistema (Master, Admin, Cadastrador, Gerencial)
        # admin / 123456
        # edkallenn / 123456
        # cadastrador / 123456
        # gerencial / 123456
        users = [
            ("usr-admin-01", "admin", hash_password("123456"), "Administrador Geral do Sistema", "admin@pf.gov.br", "ADMIN"),
            ("usr-edk-01", "edkallenn", hash_password("123456"), "Edkallenn Lima (Master)", "edkallenn@pf.gov.br", "ADMIN"),
            ("usr-cad-01", "cadastrador", hash_password("123456"), "Cadastrador Operacional de Missões", "cadastrador@pf.gov.br", "CADASTRADOR"),
            ("usr-ger-01", "gerencial", hash_password("123456"), "Gestor de Consulta Gerencial e Auditoria", "gerencial@pf.gov.br", "GERENCIAL")
        ]
        for uid, uname, pwhash, fname, mail, role in users:
            conn.execute(
                """
                INSERT INTO usuarios (id, username, password_hash, full_name, email, role, ativo)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, full_name=excluded.full_name
                """,
                (uid, uname, pwhash, fname, mail, role)
            )

        # 2. Configurações Globais
        configs = [
            ("valor_diaria_padrao", str(DEFAULT_DAILY_ALLOWANCE), "Valor base institucional da diária federal em R$"),
            ("sistema_nome", "SIS-MISSÕES PF", "Nome oficial da plataforma corporativa"),
            ("orgao_gestor", "Polícia Federal - Superintendência Regional na Paraíba", "Órgão institucional gestor do sistema"),
            ("alerta_pcdp_dias", "5", "Dias de antecedência mínima para emissão obrigatória da PCDP"),
            ("alerta_prestacao_contas_dias", "5", "Dias máximos para prestação de contas após término da missão")
        ]
        for k, v, desc in configs:
            conn.execute(
                """
                INSERT INTO configuracoes (chave, valor, descricao)
                VALUES (?, ?, ?)
                ON CONFLICT(chave) DO UPDATE SET descricao=excluded.descricao, valor=excluded.valor
                """,
                (k, v, desc)
            )

        # 3. Órgãos e Unidades da PF (Com Paraíba como primeiras opções oficiais)
        unidades = [
            ("unid-pb-01", "SR/PF/PB", "Superintendência Regional na Paraíba", "João Pessoa", "PB", 0),
            ("unid-pb-02", "CGE/PF/PB", "Delegacia de Polícia Federal em Campina Grande/PB", "Campina Grande", "PB", 0),
            ("unid-pb-03", "PAT/PF/PB", "Delegacia de Polícia Federal em Patos/PB", "Patos", "PB", 0),
            ("unid-01", "SR/PF/DF", "Superintendência Regional no Distrito Federal", "Brasília", "DF", 0),
            ("unid-02", "ANP/PF", "Academia Nacional de Polícia", "Brasília", "DF", 0),
            ("unid-03", "SR/PF/AM", "Superintendência Regional no Amazonas", "Manaus", "AM", 0),
            ("unid-04", "DPF/CAS/PR", "Delegacia de Polícia Federal em Cascavel/PR", "Cascavel", "PR", 1),
            ("unid-05", "DITEC/PF", "Diretoria Técnico-Científica", "Brasília", "DF", 0),
            ("unid-06", "DLOG/PF", "Diretoria de Logística e Administração", "Brasília", "DF", 0),
            ("unid-07", "DPF/FPL/MG", "Delegacia de Polícia Federal em Passos/MG", "Passos", "MG", 0),
            ("unid-08", "SR/PF/RJ", "Superintendência Regional no Rio de Janeiro", "Rio de Janeiro", "RJ", 0),
            ("unid-09", "SR/PF/SP", "Superintendência Regional em São Paulo", "São Paulo", "SP", 0)
        ]
        for uid, sigla, nome, mun, uf, front in unidades:
            conn.execute(
                """
                INSERT INTO orgao_unidades (id, sigla, nome_extenso, municipio, uf, is_fronteira, ativo)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(sigla) DO UPDATE SET nome_extenso=excluded.nome_extenso, municipio=excluded.municipio, uf=excluded.uf
                """,
                (uid, sigla, nome, mun, uf, front)
            )

        # 4. Cargos da Carreira Policial e Administrativa
        cargos = [
            ("crg-01", "DPF", "Delegado de Polícia Federal", 1),
            ("crg-02", "EPF", "Escrivão de Polícia Federal", 1),
            ("crg-03", "APF", "Agente de Polícia Federal", 1),
            ("crg-04", "PPF", "Papiloscopista Policial Federal", 1),
            ("crg-05", "PCF", "Perito Criminal Federal", 1),
            ("crg-06", "ADM", "Servidor Administrativo (PECPF)", 0)
        ]
        for cid, sigla, desc, pol in cargos:
            conn.execute(
                """
                INSERT INTO cargos (id, sigla, descricao, is_carreira_policial)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(sigla) DO NOTHING
                """,
                (cid, sigla, desc, pol)
            )

        # 5. Tipos de Missão
        tipos = [
            ("tp-01", "Ensino e Capacitação", "Cursos de formação, treinamentos contínuos e instruções táticas"),
            ("tp-02", "Operacional / Repressão", "Operações policiais repressivas, mandados judiciais e patrulhamento"),
            ("tp-03", "Perícia Oficial", "Exames periciais de campo, locais de crime e desastres em massa"),
            ("tp-04", "Inteligência e Investigação", "Diligências sigilosas e ações de inteligência de campo"),
            ("tp-05", "Corregedoria e Correição", "Vistorias, correições ordinárias e sindicâncias"),
            ("tp-06", "Administrativa e Logística", "Escolta de armamentos, manutenção e apoio logístico")
        ]
        for tid, nome, desc in tipos:
            conn.execute(
                """
                INSERT INTO tipos_missao (id, nome, descricao, ativo)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(nome) DO NOTHING
                """,
                (tid, nome, desc)
            )

        # 6. Papéis de Missão
        papeis = [
            ("pap-01", "Coordenador de Missão", "Líder e responsável formal pela equipe"),
            ("pap-02", "Professor / Instrutor", "Docente ou instrutor técnico designado"),
            ("pap-03", "Operador Tático", "Execução de mandados e ações táticas de campo"),
            ("pap-04", "Perito de Campo", "Peritagens e laudos periciais externos"),
            ("pap-05", "Apoio Cartorário", "Lavratura de autos e termos cartorários"),
            ("pap-06", "Apoio Logístico", "Condução de viaturas e suporte operacional"),
            ("pap-07", "Missionário Individual", "Executor exclusivo de missão individual")
        ]
        for pid, nome, desc in papeis:
            conn.execute(
                """
                INSERT INTO papeis_missao (id, nome, descricao)
                VALUES (?, ?, ?)
                ON CONFLICT(nome) DO NOTHING
                """,
                (pid, nome, desc)
            )

        # 7. Servidores Canônicos e da Paraíba
        servidores_data = [
            ("srv-01", "10293", "ALEXANDRE SILVEIRA MENDES", "SILVEIRA", "DPF", "DPF/CAS/PR", "silveira.asm", "silveira.asm@pf.gov.br", "(45) 99123-4567", 1, 1, "Especialista em Técnicas de Investigação"),
            ("srv-02", "14582", "BEATRIZ ALENCAR ROCHA", "BEATRIZ", "EPF", "SR/PF/AM", "rocha.bar", "rocha.bar@pf.gov.br", "(92) 98456-7890", 1, 1, "Apoio cartorário operacional e instrução disciplinar"),
            ("srv-03", "19874", "CARLOS EDUARDO BRAGANCA", "BRAGANCA", "APF", "SR/PF/DF", "braganca.ceb", "braganca.ceb@pf.gov.br", "(61) 99876-5432", 1, 0, "Lotado em Brasília/DF. Não gera diárias em missões no DF."),
            ("srv-04", "12459", "DANIELA FONTES MONTEIRO", "MONTEIRO", "PCF", "DITEC/PF", "monteiro.dfm", "monteiro.dfm@pf.gov.br", "(61) 98765-4321", 0, 1, "Perita em Balística Forense. Missões periciais de campo."),
            ("srv-05", "21034", "EDUARDO MARTINS COSTA", "COSTA", "PPF", "DPF/CAS/PR", "costa.emc", "costa.emc@pf.gov.br", "(45) 99345-6789", 0, 1, "Papiloscopista de campo. Perícia necropapiloscópica."),
            ("srv-06", "33412", "FRANCISCO DE ASSIS PEREIRA", "ASSIS", "DPF", "SR/PF/PB", "assis.fap", "assis.fap@pf.gov.br", "(83) 98877-1122", 1, 1, "Delegado Regional Executivo na Paraíba"),
            ("srv-07", "35891", "MARIA CLARA CAVALCANTI", "CLARA", "EPF", "CGE/PF/PB", "cavalcanti.mcc", "cavalcanti.mcc@pf.gov.br", "(83) 98765-3344", 1, 1, "Chefe de Cartório em Campina Grande/PB"),
            ("srv-08", "38104", "JOSE TAVARES SOBRINHO", "TAVARES", "APF", "PAT/PF/PB", "tavares.jts", "tavares.jts@pf.gov.br", "(83) 99123-5566", 1, 1, "Agente operacional experiente no sertão paraibano"),
            ("srv-09", "41205", "ANA BEATRIZ NOGUEIRA", "NOGUEIRA", "PCF", "SR/PF/PB", "nogueira.abn", "nogueira.abn@pf.gov.br", "(83) 99345-7788", 0, 1, "Perita Criminal Federal da SR/PB"),
            ("srv-10", "43719", "LUCAS MARANHAO GOMES", "MARANHAO", "PPF", "CGE/PF/PB", "gomes.lmg", "gomes.lmg@pf.gov.br", "(83) 98112-9900", 0, 1, "Papiloscopista de campo em Campina Grande/PB")
        ]
        for sid, mat, nome, nguerra, cargo, unid, login, mail, fone, tpe, miss_geral, obs in servidores_data:
            conn.execute(
                """
                INSERT INTO servidores (
                    id, matricula, nome_completo, nome_guerra, cargo_sigla, unidade_sigla,
                    login_rede, email_institucional, telefone_celular, tpe, is_missionario_geral,
                    observacoes_gerais, ativo
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(matricula) DO UPDATE SET
                    nome_completo=excluded.nome_completo,
                    cargo_sigla=excluded.cargo_sigla,
                    unidade_sigla=excluded.unidade_sigla,
                    is_missionario_geral=excluded.is_missionario_geral
                """,
                (sid, mat, nome, nguerra, cargo, unid, login, mail, fone, tpe, miss_geral, obs)
            )

        # 8. Missões Canônicas (Preservadas para testes existentes)
        _seed_missao(
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
                {"matricula": "19874", "papel": "Instrutor de Armamento e Tiro", "transporte": "VIATURA_OFICIAL", "inicio": "2026-05-25", "fim": "2026-06-15", "is_sede": True, "valor_diaria": 425.00, "passagem": 0.0}
            ]
        )

        _seed_missao(
            conn, mid="mis-02", codigo="MIS-2026-00102",
            titulo="Operação Sentinela - Reforço de Fronteira",
            justificativa="Fiscalização e patrulhamento em postos de fronteira no Paraná.",
            tipo="Operacional / Repressão", solicitante="DPF/CAS/PR", destino="DPF/CAS/PR",
            localidade="Foz do Iguaçu e Guaíra/PR", dt_inicio="2026-06-01", dt_fim="2026-06-12",
            responsavel_mat="10293", status="APROVADA", modalidade="EQUIPE",
            valor_diaria=425.00, om="OM-2026-0210", pcdp="PCDP-005881/26", sat="SAT-2026-00588",
            sei="08200.005544/2026-44", obs="Apoio aéreo e terrestre",
            participantes=[
                {"matricula": "21034", "papel": "Operador Tático", "transporte": "AEREO", "inicio": "2026-06-01", "fim": "2026-06-12", "is_sede": False, "valor_diaria": 425.00, "passagem": 1200.00}
            ]
        )

        _seed_missao(
            conn, mid="mis-03", codigo="MIS-2026-00103",
            titulo="Perícia Integrada em Local de Desastre Ambiental",
            justificativa="Atuação conjunta de peritos criminais federais em sinistro ambiental.",
            tipo="Perícia Oficial", solicitante="DITEC/PF", destino="SR/PF/AM",
            localidade="Humaitá e Manicoré/AM", dt_inicio="2026-07-10", dt_fim="2026-07-20",
            responsavel_mat="12459", status="SOLICITADA", modalidade="EQUIPE",
            valor_diaria=450.00, om=None, pcdp=None, sat="SAT-2026-00910",
            sei="08200.008899/2026-72", obs="Diária diferenciada para área remota amazônica (R$ 450,00).",
            participantes=[
                {"matricula": "12459", "papel": "Perito de Campo", "transporte": "AEREO", "inicio": "2026-07-10", "fim": "2026-07-20", "is_sede": False, "valor_diaria": 450.00, "passagem": 2100.00}
            ]
        )

        # 9. MISSÕES MOCK COBRINDO TODOS OS 12 MESES DE 2026 (COM FOCO NA PARAÍBA)
        missoes_2026 = [
            # JANEIRO 2026
            {
                "mid": "mis-2026-01", "codigo": "MIS-2026-00010",
                "titulo": "Operação Verão Litoral Paraibano",
                "justificativa": "Reforço no patrulhamento marítimo e repressão ao tráfico de entorpecentes no litoral da PB.",
                "tipo": "Operacional / Repressão", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB",
                "localidade": "João Pessoa e Cabedelo/PB", "inicio": "2026-01-05", "fim": "2026-01-16",
                "resp": "33412", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00012", "om": "OM-2026-0005", "pcdp": "PCDP-000101/26",
                "parts": [
                    {"matricula": "38104", "papel": "Operador Tático", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0},
                    {"matricula": "43719", "papel": "Apoio Técnico", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-02", "codigo": "MIS-2026-00011",
                "titulo": "Auditoria Forense Contábil em Cajazeiras",
                "justificativa": "Diligência pericial de instrução em processo de desvio de verbas públicas federais.",
                "tipo": "Perícia Oficial", "solicitante": "PAT/PF/PB", "destino": "PAT/PF/PB",
                "localidade": "Cajazeiras/PB", "inicio": "2026-01-19", "fim": "2026-01-26",
                "resp": "38104", "miss": "41205", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00018", "om": "OM-2026-0012", "pcdp": "PCDP-000102/26"
            },
            {
                "mid": "mis-2026-03", "codigo": "MIS-2026-00012",
                "titulo": "Inspeção e Correição em Campina Grande",
                "justificativa": "Correição ordinária nas rotinas de inquéritos policiais da DPF em Campina Grande.",
                "tipo": "Corregedoria e Correição", "solicitante": "SR/PF/PB", "destino": "CGE/PF/PB",
                "localidade": "Campina Grande/PB", "inicio": "2026-01-22", "fim": "2026-01-30",
                "resp": "33412", "miss": "35891", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00025", "om": "OM-2026-0018", "pcdp": "PCDP-000103/26"
            },

            # FEVEREIRO 2026
            {
                "mid": "mis-2026-04", "codigo": "MIS-2026-00020",
                "titulo": "Operação Folião Seguro - Carnaval PB",
                "justificativa": "Segurança aeroportuária e repressão a fraudes com moeda falsa no carnaval da PB.",
                "tipo": "Operacional / Repressão", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB",
                "localidade": "João Pessoa e Lucena/PB", "inicio": "2026-02-12", "fim": "2026-02-19",
                "resp": "33412", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00035", "om": "OM-2026-0030", "pcdp": "PCDP-000201/26",
                "parts": [
                    {"matricula": "38104", "papel": "Operador Tático", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-05", "codigo": "MIS-2026-00021",
                "titulo": "Escolta Interestadual de Preso Perigoso",
                "justificativa": "Transferência de custodiado da DPF Campina Grande para presídio federal.",
                "tipo": "Administrativa e Logística", "solicitante": "CGE/PF/PB", "destino": "SR/PF/RN",
                "localidade": "Mossoró/RN", "inicio": "2026-02-20", "fim": "2026-02-25",
                "resp": "35891", "miss": "38104", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00042", "om": "OM-2026-0038", "pcdp": "PCDP-000202/26"
            },

            # MARÇO 2026
            {
                "mid": "mis-2026-06", "codigo": "MIS-2026-00030",
                "titulo": "Operação Tabajara - Combate a Fraudes Previdenciárias",
                "justificativa": "Cumprimento de 12 mandados de busca e apreensão na região metropolitana de João Pessoa.",
                "tipo": "Operacional / Repressão", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB",
                "localidade": "Bayeux e Santa Rita/PB", "inicio": "2026-03-04", "fim": "2026-03-15",
                "resp": "33412", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00060", "om": "OM-2026-0052", "pcdp": "PCDP-000301/26",
                "parts": [
                    {"matricula": "35891", "papel": "Apoio Cartorário", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0},
                    {"matricula": "43719", "papel": "Perito Necropapiloscopista", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-07", "codigo": "MIS-2026-00031",
                "titulo": "Perícia Balística e Coleta de Vestígios em Sousa",
                "justificativa": "Exame pericial de local de confronto armado envolvendo roubo de cargas.",
                "tipo": "Perícia Oficial", "solicitante": "PAT/PF/PB", "destino": "PAT/PF/PB",
                "localidade": "Sousa/PB", "inicio": "2026-03-18", "fim": "2026-03-26",
                "resp": "38104", "miss": "41205", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00072", "om": "OM-2026-0065", "pcdp": "PCDP-000302/26"
            },

            # ABRIL 2026
            {
                "mid": "mis-2026-08", "codigo": "MIS-2026-00040",
                "titulo": "Operação Rota Borborema - Repressão ao Tráfico Interestadual",
                "justificativa": "Barreiras e fiscalização de entorpecentes nas rodovias de acesso a Campina Grande.",
                "tipo": "Operacional / Repressão", "solicitante": "CGE/PF/PB", "destino": "CGE/PF/PB",
                "localidade": "Campina Grande e Queimadas/PB", "inicio": "2026-04-06", "fim": "2026-04-17",
                "resp": "35891", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00095", "om": "OM-2026-0080", "pcdp": "PCDP-000401/26",
                "parts": [
                    {"matricula": "38104", "papel": "Operador Tático", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-09", "codigo": "MIS-2026-00041",
                "titulo": "Capacitação Regional em Coleta de Impressões Digitais",
                "justificativa": "Instrutoria técnica sobre novas técnicas de revelação em suporte não poroso.",
                "tipo": "Ensino e Capacitação", "solicitante": "SR/PF/PB", "destino": "CGE/PF/PB",
                "localidade": "Campina Grande/PB", "inicio": "2026-04-20", "fim": "2026-04-25",
                "resp": "33412", "miss": "43719", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00108", "om": "OM-2026-0092", "pcdp": "PCDP-000402/26"
            },

            # MAIO 2026
            {
                "mid": "mis-2026-10", "codigo": "MIS-2026-00050",
                "titulo": "Operação Mandacaru - Combate a Crimes Ambientais no Sertão",
                "justificativa": "Fiscalização de desmatamento ilegal e captação clandestina no Vale do Piancó.",
                "tipo": "Operacional / Repressão", "solicitante": "PAT/PF/PB", "destino": "PAT/PF/PB",
                "localidade": "Itaporanga e Piancó/PB", "inicio": "2026-05-04", "fim": "2026-05-15",
                "resp": "38104", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00130", "om": "OM-2026-0112", "pcdp": "PCDP-000501/26",
                "parts": [
                    {"matricula": "41205", "papel": "Perito Ambiental", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-11", "codigo": "MIS-2026-00051",
                "titulo": "Diligência Sigilosa da Delegacia de Defesa Institucional",
                "justificativa": "Investigação sobre ameaças a autoridades públicas no sertão paraibano.",
                "tipo": "Inteligência e Investigação", "solicitante": "SR/PF/PB", "destino": "PAT/PF/PB",
                "localidade": "Patos/PB", "inicio": "2026-05-18", "fim": "2026-05-24",
                "resp": "33412", "miss": "38104", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00145", "om": "OM-2026-0125", "pcdp": "PCDP-000502/26"
            },

            # JUNHO 2026
            {
                "mid": "mis-2026-12", "codigo": "MIS-2026-00060",
                "titulo": "Operação São João Seguro - Maior São João do Mundo",
                "justificativa": "Reforço ostensivo extraordinário no Parque do Povo durante festejos juninos de Campina Grande.",
                "tipo": "Operacional / Repressão", "solicitante": "CGE/PF/PB", "destino": "CGE/PF/PB",
                "localidade": "Campina Grande/PB", "inicio": "2026-06-08", "fim": "2026-06-28",
                "resp": "35891", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00170", "om": "OM-2026-0160", "pcdp": "PCDP-000601/26",
                "parts": [
                    {"matricula": "38104", "papel": "Operador Tático", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0},
                    {"matricula": "43719", "papel": "Apoio Papiloscópico", "transporte": "VIATURA_OFICIAL", "is_sede": True, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-13", "codigo": "MIS-2026-00061",
                "titulo": "Fiscalização de Segurança Privada nos Festejos de Patos",
                "justificativa": "Vistoria formal e autuação de empresas de segurança privada não homologadas pelo MJSP.",
                "tipo": "Administrativa e Logística", "solicitante": "PAT/PF/PB", "destino": "PAT/PF/PB",
                "localidade": "Patos/PB", "inicio": "2026-06-17", "fim": "2026-06-25",
                "resp": "38104", "miss": "38104", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00185", "om": "OM-2026-0175", "pcdp": "PCDP-000602/26"
            },

            # JULHO 2026
            {
                "mid": "mis-2026-14", "codigo": "MIS-2026-00070",
                "titulo": "Operação Costa Dourada - Proteção de Terras Indígenas",
                "justificativa": "Inspeção fundiária e combate ao loteamento irregular em áreas da União no litoral norte.",
                "tipo": "Operacional / Repressão", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB",
                "localidade": "Baía da Traição e Rio Tinto/PB", "inicio": "2026-07-06", "fim": "2026-07-17",
                "resp": "33412", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00210", "om": "OM-2026-0195", "pcdp": "PCDP-000701/26",
                "parts": [
                    {"matricula": "41205", "papel": "Perito Ambiental", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-15", "codigo": "MIS-2026-00071",
                "titulo": "Perícia Financeira em Contratos Públicos Municipais",
                "justificativa": "Laudo pericial financeiro em tomada de contas especial.",
                "tipo": "Perícia Oficial", "solicitante": "CGE/PF/PB", "destino": "SR/PF/PB",
                "localidade": "João Pessoa/PB", "inicio": "2026-07-20", "fim": "2026-07-28",
                "resp": "35891", "miss": "41205", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00225", "om": "OM-2026-0205", "pcdp": "PCDP-000702/26"
            },

            # AGOSTO 2026
            {
                "mid": "mis-2026-16", "codigo": "MIS-2026-00080",
                "titulo": "Operação Pedra do Reino - Desarticulação de Quadrilha de Roubo a Bancos",
                "justificativa": "Cumprimento de 8 mandados de prisão temporária no cariri paraibano.",
                "tipo": "Operacional / Repressão", "solicitante": "CGE/PF/PB", "destino": "CGE/PF/PB",
                "localidade": "Monteiro e Sumé/PB", "inicio": "2026-08-03", "fim": "2026-08-14",
                "resp": "35891", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00248", "om": "OM-2026-0220", "pcdp": "PCDP-000801/26",
                "parts": [
                    {"matricula": "38104", "papel": "Operador Tático", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0},
                    {"matricula": "43719", "papel": "Identificação Papiloscópica", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-17", "codigo": "MIS-2026-00081",
                "titulo": "Vistoria Técnica de Segurança Aeroportuária em Campina Grande",
                "justificativa": "Auditoria de certificação AVSEC no Aeroporto Presidente João Suassuna.",
                "tipo": "Administrativa e Logística", "solicitante": "SR/PF/PB", "destino": "CGE/PF/PB",
                "localidade": "Campina Grande/PB", "inicio": "2026-08-17", "fim": "2026-08-23",
                "resp": "33412", "miss": "33412", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00260", "om": "OM-2026-0235", "pcdp": "PCDP-000802/26"
            },

            # SETEMBRO 2026
            {
                "mid": "mis-2026-18", "codigo": "MIS-2026-00090",
                "titulo": "Operação Asa Branca - Repressão a Desvios de Recursos Hídricos",
                "justificativa": "Ação fiscalizatória com a ANA e IBAMA ao longo dos canais da Transposição do São Francisco.",
                "tipo": "Operacional / Repressão", "solicitante": "PAT/PF/PB", "destino": "PAT/PF/PB",
                "localidade": "São José de Piranhas e Cajazeiras/PB", "inicio": "2026-09-02", "fim": "2026-09-14",
                "resp": "38104", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00285", "om": "OM-2026-0255", "pcdp": "PCDP-000901/26",
                "parts": [
                    {"matricula": "41205", "papel": "Perito de Campo", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-19", "codigo": "MIS-2026-00091",
                "titulo": "Auditoria de Armamento e Munições da DPF Patos",
                "justificativa": "Conferência física semestral do estoque de material bélico e coletes balísticos.",
                "tipo": "Administrativa e Logística", "solicitante": "SR/PF/PB", "destino": "PAT/PF/PB",
                "localidade": "Patos/PB", "inicio": "2026-09-16", "fim": "2026-09-22",
                "resp": "33412", "miss": "38104", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00298", "om": "OM-2026-0270", "pcdp": "PCDP-000902/26"
            },

            # OUTUBRO 2026
            {
                "mid": "mis-2026-20", "codigo": "MIS-2026-00100",
                "titulo": "Operação Eleições 2026 - Primeiro Turno PB",
                "justificativa": "Plano operacional de garantia da votação e combate a crimes eleitorais em todo estado da PB.",
                "tipo": "Operacional / Repressão", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB",
                "localidade": "João Pessoa, CG e Patos/PB", "inicio": "2026-10-01", "fim": "2026-10-06",
                "resp": "33412", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00315", "om": "OM-2026-0290", "pcdp": "PCDP-001001/26",
                "parts": [
                    {"matricula": "38104", "papel": "Operador Tático", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0},
                    {"matricula": "35891", "papel": "Apoio Cartorário", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-21", "codigo": "MIS-2026-00104",
                "titulo": "Investigação Eleitoral de Campo - Compra de Votos",
                "justificativa": "Diligência urgente decorrente de flagrante delito encaminhado pelo TRE-PB.",
                "tipo": "Inteligência e Investigação", "solicitante": "CGE/PF/PB", "destino": "CGE/PF/PB",
                "localidade": "Esperança e Pocinhos/PB", "inicio": "2026-10-08", "fim": "2026-10-15",
                "resp": "35891", "miss": "35891", "modalidade": "INDIVIDUAL", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00325", "om": "OM-2026-0305", "pcdp": "PCDP-001002/26"
            },
            {
                "mid": "mis-2026-22", "codigo": "MIS-2026-00105",
                "titulo": "Operação Eleições 2026 - Segundo Turno PB",
                "justificativa": "Desdobramento do plano de segurança e integridade eleitoral na Paraíba.",
                "tipo": "Operacional / Repressão", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB",
                "localidade": "João Pessoa e Campina Grande/PB", "inicio": "2026-10-22", "fim": "2026-10-27",
                "resp": "33412", "miss": None, "modalidade": "EQUIPE", "status": "CONCLUIDA", "diaria": 425.00,
                "sat": "SAT-2026-00340", "om": "OM-2026-0315", "pcdp": "PCDP-001003/26",
                "parts": [
                    {"matricula": "43719", "papel": "Apoio Operacional", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },

            # NOVEMBRO 2026
            {
                "mid": "mis-2026-23", "codigo": "MIS-2026-00114",
                "titulo": "Operação Patrimônio Histórico - Areia e Bananeiras",
                "justificativa": "Fiscalização de crimes contra o patrimônio histórico, artístico e cultural no brejo paraibano.",
                "tipo": "Operacional / Repressão", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB",
                "localidade": "Areia e Bananeiras/PB", "inicio": "2026-11-03", "fim": "2026-11-13",
                "resp": "33412", "miss": None, "modalidade": "EQUIPE", "status": "EM_ANDAMENTO", "diaria": 425.00,
                "sat": "SAT-2026-00360", "om": "OM-2026-0340", "pcdp": "PCDP-001101/26",
                "parts": [
                    {"matricula": "41205", "papel": "Perito de Campo", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-24", "codigo": "MIS-2026-00115",
                "titulo": "Diligência Postal - Combate a Remessa Ilícita de Drogas",
                "justificativa": "Inspeção e apreensão de encomendas em centro de triagem dos Correios.",
                "tipo": "Inteligência e Investigação", "solicitante": "CGE/PF/PB", "destino": "CGE/PF/PB",
                "localidade": "Campina Grande/PB", "inicio": "2026-11-09", "fim": "2026-11-19",
                "resp": "35891", "miss": "38104", "modalidade": "INDIVIDUAL", "status": "EM_ANDAMENTO", "diaria": 425.00,
                "sat": "SAT-2026-00375", "om": "OM-2026-0352", "pcdp": "PCDP-001102/26"
            },
            {
                "mid": "mis-2026-25", "codigo": "MIS-2026-00116",
                "titulo": "Perícia Balística e Coleta em Confronto com Assaltantes",
                "justificativa": "Instrução pericial de urgência em sinistro no trecho sertanejo da BR-230.",
                "tipo": "Perícia Oficial", "solicitante": "PAT/PF/PB", "destino": "PAT/PF/PB",
                "localidade": "Pombal/PB", "inicio": "2026-11-16", "fim": "2026-11-25",
                "resp": "38104", "miss": "41205", "modalidade": "INDIVIDUAL", "status": "EM_ANALISE", "diaria": 425.00,
                "sat": "SAT-2026-00390", "om": None, "pcdp": None
            },

            # DEZEMBRO 2026
            {
                "mid": "mis-2026-26", "codigo": "MIS-2026-00124",
                "titulo": "Operação Fim de Ano Seguro Paraíba",
                "justificativa": "Reforço no patrulhamento em terminais rodoviários e portuários de Cabedelo.",
                "tipo": "Operacional / Repressão", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB",
                "localidade": "João Pessoa e Cabedelo/PB", "inicio": "2026-12-07", "fim": "2026-12-22",
                "resp": "33412", "miss": None, "modalidade": "EQUIPE", "status": "APROVADA", "diaria": 425.00,
                "sat": "SAT-2026-00410", "om": "OM-2026-0388", "pcdp": "PCDP-001201/26",
                "parts": [
                    {"matricula": "38104", "papel": "Operador Tático", "transporte": "VIATURA_OFICIAL", "is_sede": False, "passagem": 0.0}
                ]
            },
            {
                "mid": "mis-2026-27", "codigo": "MIS-2026-00125",
                "titulo": "Monitoramento Interestadual de Cargas de Alto Valor",
                "justificativa": "Ação preventiva integrada com a PRF no entroncamento rodoviário de Campina Grande.",
                "tipo": "Inteligência e Investigação", "solicitante": "CGE/PF/PB", "destino": "CGE/PF/PB",
                "localidade": "Campina Grande/PB", "inicio": "2026-12-14", "fim": "2026-12-24",
                "resp": "35891", "miss": "43719", "modalidade": "INDIVIDUAL", "status": "SOLICITADA", "diaria": 425.00,
                "sat": "SAT-2026-00425"
            },
            {
                "mid": "mis-2026-28", "codigo": "MIS-2026-00126",
                "titulo": "Planejamento Estratégico e Metas Institucionais 2027",
                "justificativa": "Reunião de alinhamento com os chefes de delegacias descentralizadas da PB.",
                "tipo": "Administrativa e Logística", "solicitante": "SR/PF/PB", "destino": "SR/PF/PB",
                "localidade": "João Pessoa/PB", "inicio": "2026-12-26", "fim": "2026-12-30",
                "resp": "33412", "miss": "33412", "modalidade": "INDIVIDUAL", "status": "RASCUNHO", "diaria": 425.00
            }
        ]

        for mdata in missoes_2026:
            _seed_missao(
                conn,
                mid=mdata["mid"],
                codigo=mdata["codigo"],
                titulo=mdata["titulo"],
                justificativa=mdata["justificativa"],
                tipo=mdata["tipo"],
                solicitante=mdata["solicitante"],
                destino=mdata["destino"],
                localidade=mdata["localidade"],
                dt_inicio=mdata["inicio"],
                dt_fim=mdata["fim"],
                responsavel_mat=mdata["resp"],
                missionario_mat=mdata.get("miss"),
                modalidade=mdata.get("modalidade", "EQUIPE"),
                status=mdata["status"],
                valor_diaria=mdata.get("diaria", 425.00),
                sat=mdata.get("sat"),
                om=mdata.get("om"),
                pcdp=mdata.get("pcdp"),
                participantes=mdata.get("parts")
            )
