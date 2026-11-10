import uuid
from app.database import get_db, init_db
from app.auth import hash_password
from app.calculator import compute_participant_financials
from app.config import DEFAULT_DAILY_ALLOWANCE

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

        # 2. Configurações Globais (incluindo valor de diária padrão do sistema)
        configs = [
            ("valor_diaria_padrao", str(DEFAULT_DAILY_ALLOWANCE), "Valor base institucional da diária federal em R$"),
            ("sistema_nome", "SIS-MISSÕES PF", "Nome oficial da plataforma corporativa"),
            ("orgao_gestor", "Polícia Federal - DGI / ANP", "Órgão institucional gestor do sistema"),
            ("alerta_pcdp_dias", "5", "Dias de antecedência mínima para emissão obrigatória da PCDP"),
            ("alerta_prestacao_contas_dias", "5", "Dias máximos para prestação de contas após término da missão")
        ]
        for k, v, desc in configs:
            conn.execute(
                """
                INSERT INTO configuracoes (chave, valor, descricao)
                VALUES (?, ?, ?)
                ON CONFLICT(chave) DO UPDATE SET descricao=excluded.descricao
                """,
                (k, v, desc)
            )

        # 3. Órgãos e Unidades da PF
        unidades = [
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
                ON CONFLICT(sigla) DO NOTHING
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
            ("tp-01", "Ensino e Capacitação", "Cursos de formação (CFP), treinamentos contínuos e instruções táticas"),
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
            ("pap-06", "Apoio Logístico", "Condução de viaturas e suporte operacional")
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

        # 7. Servidores Canônicos
        servidores_data = [
            ("srv-01", "10293", "ALEXANDRE SILVEIRA MENDES", "SILVEIRA", "DPF", "DPF/CAS/PR", "silveira.asm", "silveira.asm@pf.gov.br", "(45) 99123-4567", 1, 1, "Especialista em Técnicas de Investigação e Docente ANP"),
            ("srv-02", "14582", "BEATRIZ ALENCAR ROCHA", "BEATRIZ", "EPF", "SR/PF/AM", "rocha.bar", "rocha.bar@pf.gov.br", "(92) 98456-7890", 1, 1, "Apoio cartorário operacional e instrução de processos disciplinares"),
            ("srv-03", "19874", "CARLOS EDUARDO BRAGANCA", "BRAGANCA", "APF", "SR/PF/DF", "braganca.ceb", "braganca.ceb@pf.gov.br", "(61) 99876-5432", 1, 0, "Lotado em Brasília/DF. Não gera diárias em missões na ANP/DF (Sede)."),
            ("srv-04", "12459", "DANIELA FONTES MONTEIRO", "MONTEIRO", "PCF", "DITEC/PF", "monteiro.dfm", "monteiro.dfm@pf.gov.br", "(61) 98765-4321", 0, 1, "Perita em Balística Forense. Missões periciais de campo."),
            ("srv-05", "21034", "EDUARDO MARTINS COSTA", "COSTA", "PPF", "DPF/CAS/PR", "costa.emc", "costa.emc@pf.gov.br", "(45) 99345-6789", 0, 1, "Papiloscopista de campo. Perícia necropapiloscópica.")
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

        # 8. Missões Canônicas com Cálculo Financeiro e Diária Editável
        # Missão 1: CFP 2026 (Ensino ANP)
        m1_id = "mis-01"
        m1_cod = "MIS-2026-00101"
        m1_inicio = "2026-05-25"
        m1_fim = "2026-06-15"
        m1_dias = 22
        m1_diaria_padrao = 425.00

        conn.execute(
            """
            INSERT INTO missoes (
                id, codigo_missao, titulo, justificativa, tipo_missao, unidade_solicitante,
                unidade_destino, localidade_descricao, data_inicio, data_termino, total_dias,
                responsavel_matricula, status_atual, numero_sat, numero_om, numero_pcdp,
                processo_sei, valor_diaria_padrao, observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(codigo_missao) DO NOTHING
            """,
            (
                m1_id, m1_cod, "Instrução do Curso de Formação Profissional - CFP 2026",
                "Convocação de instrutores para ministrar disciplinas no CFP/2026.",
                "Ensino e Capacitação", "ANP/PF", "ANP/PF",
                "Academia Nacional de Polícia, Brasília/DF",
                m1_inicio, m1_fim, m1_dias, "10293", "OM_EMITIDA",
                "SAT-2026-00412", "OM-2026-0158", "PCDP-004120/26", "08200.001234/2026-11",
                m1_diaria_padrao, "Missão autorizada pelo Diretor da ANP."
            )
        )

        # Participantes Missão 1:
        # Participante A: Alexandre Silveira (DPF de Cascavel -> viaja a Brasília => recebe diárias)
        fin_a = compute_participant_financials(
            data_apresentacao="2026-05-25",
            data_retorno="2026-06-15",
            is_sede=False,
            valor_diaria_unitaria=m1_diaria_padrao,
            valor_passagem_aerea=1650.00
        )
        conn.execute(
            """
            INSERT INTO missoes_participantes (
                id, missao_id, servidor_matricula, papel, meio_transporte, data_apresentacao,
                data_retorno, dias_participacao, is_missao_sede, qtd_diarias, valor_diaria_unitaria,
                valor_total_diarias, valor_passagem_aerea, outros_custos, custo_total_servidor,
                localizador_aereo, observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(missao_id, servidor_matricula, data_apresentacao) DO NOTHING
            """,
            (
                "part-01", m1_id, "10293", "Professor Coordenador", "AEREO",
                "2026-05-25", "2026-06-15", fin_a["dias_participacao"], 0,
                fin_a["qtd_diarias"], fin_a["valor_diaria_unitaria"], fin_a["valor_total_diarias"],
                fin_a["valor_passagem_aerea"], 0.0, fin_a["custo_total_servidor"],
                "ABC12D", "Docente de Investigação Policial"
            )
        )

        # Participante B: Carlos Eduardo (APF lotado em Brasília / SR/PF/DF => sede da missão, 0 diárias)
        fin_b = compute_participant_financials(
            data_apresentacao="2026-05-25",
            data_retorno="2026-06-15",
            is_sede=True,
            valor_diaria_unitaria=m1_diaria_padrao,
            valor_passagem_aerea=0.0
        )
        conn.execute(
            """
            INSERT INTO missoes_participantes (
                id, missao_id, servidor_matricula, papel, meio_transporte, data_apresentacao,
                data_retorno, dias_participacao, is_missao_sede, qtd_diarias, valor_diaria_unitaria,
                valor_total_diarias, valor_passagem_aerea, outros_custos, custo_total_servidor,
                localizador_aereo, observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(missao_id, servidor_matricula, data_apresentacao) DO NOTHING
            """,
            (
                "part-02", m1_id, "19874", "Instrutor de Armamento e Tiro", "VIATURA_OFICIAL",
                "2026-05-25", "2026-06-15", fin_b["dias_participacao"], 1,
                fin_b["qtd_diarias"], fin_b["valor_diaria_unitaria"], fin_b["valor_total_diarias"],
                fin_b["valor_passagem_aerea"], 0.0, fin_b["custo_total_servidor"],
                "", "Efetivo lotado na sede da missão (ANP/DF) - sem diárias"
            )
        )

        # Missão 2: Operação Sentinela Fronteira (Operacional)
        m2_id = "mis-02"
        m2_cod = "MIS-2026-00102"
        m2_inicio = "2026-06-01"
        m2_fim = "2026-06-12"
        m2_dias = 12
        m2_diaria_padrao = 425.00

        conn.execute(
            """
            INSERT INTO missoes (
                id, codigo_missao, titulo, justificativa, tipo_missao, unidade_solicitante,
                unidade_destino, localidade_descricao, data_inicio, data_termino, total_dias,
                responsavel_matricula, status_atual, numero_sat, numero_om, numero_pcdp,
                processo_sei, valor_diaria_padrao, observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(codigo_missao) DO NOTHING
            """,
            (
                m2_id, m2_cod, "Operação Sentinela - Reforço de Fronteira",
                "Fiscalização e patrulhamento em postos de fronteira no Paraná.",
                "Operacional / Repressão", "DPF/CAS/PR", "DPF/CAS/PR",
                "Foz do Iguaçu e Guaíra/PR",
                m2_inicio, m2_fim, m2_dias, "10293", "APROVADA",
                "SAT-2026-00588", "OM-2026-0210", "PCDP-005881/26", "08200.005544/2026-44",
                m2_diaria_padrao, "Apoio aéreo e terrestre"
            )
        )

        # Participante Missão 2: Eduardo Martins Costa (PPF)
        fin_c = compute_participant_financials(
            data_apresentacao="2026-06-01",
            data_retorno="2026-06-12",
            is_sede=False,
            valor_diaria_unitaria=m2_diaria_padrao,
            valor_passagem_aerea=1200.00
        )
        conn.execute(
            """
            INSERT INTO missoes_participantes (
                id, missao_id, servidor_matricula, papel, meio_transporte, data_apresentacao,
                data_retorno, dias_participacao, is_missao_sede, qtd_diarias, valor_diaria_unitaria,
                valor_total_diarias, valor_passagem_aerea, outros_custos, custo_total_servidor,
                localizador_aereo, observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(missao_id, servidor_matricula, data_apresentacao) DO NOTHING
            """,
            (
                "part-03", m2_id, "21034", "Operador Tático", "AEREO",
                "2026-06-01", "2026-06-12", fin_c["dias_participacao"], 0,
                fin_c["qtd_diarias"], fin_c["valor_diaria_unitaria"], fin_c["valor_total_diarias"],
                fin_c["valor_passagem_aerea"], 0.0, fin_c["custo_total_servidor"],
                "KLM99X", "Identificação necropapiloscópica avançada em área de fronteira"
            )
        )

        # Missão 3: Perícia Integrada em Local de Desastre Ambiental (Perícia)
        m3_id = "mis-03"
        m3_cod = "MIS-2026-00103"
        m3_inicio = "2026-07-10"
        m3_fim = "2026-07-20"
        m3_dias = 11
        m3_diaria_padrao = 450.00  # Exemplo de missão com valor de diária editado para R$ 450,00!

        conn.execute(
            """
            INSERT INTO missoes (
                id, codigo_missao, titulo, justificativa, tipo_missao, unidade_solicitante,
                unidade_destino, localidade_descricao, data_inicio, data_termino, total_dias,
                responsavel_matricula, status_atual, numero_sat, numero_om, numero_pcdp,
                processo_sei, valor_diaria_padrao, observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(codigo_missao) DO NOTHING
            """,
            (
                m3_id, m3_cod, "Perícia Integrada em Local de Desastre Ambiental",
                "Atuação conjunta de peritos criminais federais em sinistro ambiental.",
                "Perícia Oficial", "DITEC/PF", "SR/PF/AM",
                "Humaitá e Manicoré/AM",
                m3_inicio, m3_fim, m3_dias, "12459", "SOLICITADA",
                "SAT-2026-00910", None, None, "08200.008899/2026-72",
                m3_diaria_padrao, "Diária diferenciada para área remota amazônica (R$ 450,00)."
            )
        )

        fin_d = compute_participant_financials(
            data_apresentacao="2026-07-10",
            data_retorno="2026-07-20",
            is_sede=False,
            valor_diaria_unitaria=m3_diaria_padrao,
            valor_passagem_aerea=2100.00
        )
        conn.execute(
            """
            INSERT INTO missoes_participantes (
                id, missao_id, servidor_matricula, papel, meio_transporte, data_apresentacao,
                data_retorno, dias_participacao, is_missao_sede, qtd_diarias, valor_diaria_unitaria,
                valor_total_diarias, valor_passagem_aerea, outros_custos, custo_total_servidor,
                localizador_aereo, observacoes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(missao_id, servidor_matricula, data_apresentacao) DO NOTHING
            """,
            (
                "part-04", m3_id, "12459", "Perito de Campo", "AEREO",
                "2026-07-10", "2026-07-20", fin_d["dias_participacao"], 0,
                fin_d["qtd_diarias"], fin_d["valor_diaria_unitaria"], fin_d["valor_total_diarias"],
                fin_d["valor_passagem_aerea"], 0.0, fin_d["custo_total_servidor"],
                "LAT44Z", "Exames físico-químicos e amostragem de solo fluvial"
            )
        )
