import uuid
from app.database import get_db, init_db
from app.auth import hash_password
from app.config import DEFAULT_DAILY_ALLOWANCE


def seed_database(db_path: str = None):
    """
    Inicializa o schema e popula exclusivamente dados essenciais de autenticação
    e tabelas de domínio/referência institucionais (sem dados mockados de
    servidores, missões ou auditoria).

    Operação idempotente: conflitos preservam registros existentes para não
    sobrescrever senhas alteradas ou parâmetros ajustados após a implantação.
    """
    init_db(db_path)
    with get_db(db_path) as conn:
        # 1. Usuários iniciais do sistema (alterar todas as senhas após o primeiro acesso)
        users = [
            ("usr-admin-01", "admin", hash_password("123456"), "Administrador Geral do Sistema", "admin@pf.gov.br", "ADMIN"),
            ("usr-edk-01", "edkallenn", hash_password("123456"), "Edkallenn Lima (Master)", "edkallenn@pf.gov.br", "ADMIN"),
            ("usr-cad-01", "cadastrador", hash_password("123456"), "Cadastrador Operacional de Missões", "cadastrador@pf.gov.br", "CADASTRADOR"),
            ("usr-ger-01", "gerencial", hash_password("123456"), "Gestor de Consulta Gerencial e Auditoria", "gerencial@pf.gov.br", "GERENCIAL"),
        ]
        for uid, uname, pwhash, fname, mail, role in users:
            conn.execute(
                """
                INSERT INTO usuarios (id, username, password_hash, full_name, email, role, ativo)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(username) DO NOTHING
                """,
                (uid, uname, pwhash, fname, mail, role),
            )

        # 2. Configurações Globais
        configs = [
            ("valor_diaria_padrao", str(DEFAULT_DAILY_ALLOWANCE), "Valor base institucional da diária federal em R$"),
            ("sistema_nome", "Sistema de Controle de Diárias e Passagens", "Nome oficial da plataforma corporativa"),
            ("orgao_gestor", "Polícia Federal - Superintendência Regional na Paraíba", "Órgão institucional gestor do sistema"),
            ("alerta_pcdp_dias", "5", "Dias de antecedência mínima para emissão obrigatória da PCDP"),
            ("alerta_prestacao_contas_dias", "5", "Dias máximos para prestação de contas após término da missão"),
            ("alerta_passagem_aerea_dias", "17", "Dias de antecedência/término para emissão de bilhetes aéreos e alerta aos servidores"),
        ]
        for k, v, desc in configs:
            conn.execute(
                """
                INSERT INTO configuracoes (chave, valor, descricao)
                VALUES (?, ?, ?)
                ON CONFLICT(chave) DO NOTHING
                """,
                (k, v, desc),
            )

        # 2.1 Tabela de Valores de Diárias (Interior R$335, Capitais R$380, DF/RJ/SP/AM R$425)
        valores_diarias_data = [
            ("val-interior", "INTERIOR", "Destino cidade do interior do país", 335.00),
            ("val-capitais", "CAPITAIS", "Destino capitais do país", 380.00),
            ("val-especiais", "CAPITAIS_ESPECIAIS", "Destino capitais DF, RJ, SP e AM (e Diretorias DF)", 425.00),
        ]
        for vid, cat, desc, val in valores_diarias_data:
            conn.execute(
                """
                INSERT INTO valores_diarias (id, categoria, descricao, valor, ativo)
                VALUES (?, ?, ?, ?, 1)
                ON CONFLICT(categoria) DO NOTHING
                """,
                (vid, cat, desc, val),
            )

        # 2.2 Setores de Destino Oficiais vinculados à SR/PF/PB
        setores_pb = [
            ("BAN", "Bancada / Atendimento Bancário"),
            ("CONFGEST", "Conformidade de Gestão"),
            ("CONFREG", "Conformidade de Registro"),
            ("COR", "Corregedoria Regional"),
            ("COREG", "Coordenação Regional"),
            ("CPL", "Comissão Permanente de Licitação"),
            ("CS", "Comunicação Social"),
            ("DELEAQ", "Delegacia de Controle de Armas e Produtos Químicos"),
            ("DELECIBER", "Delegacia de Repressão a Crimes Cibernéticos"),
            ("DELECOR", "Delegacia de Repressão à Corrupção"),
            ("DELEFAZ", "Delegacia de Repressão a Crimes Fazendários"),
            ("DELEFIN", "Delegacia de Repressão a Crimes Financeiros"),
            ("DELEMAPH", "Delegacia de Meio Ambiente e Patrimônio Histórico"),
            ("DELEMIG", "Delegacia de Polícia de Imigração"),
            ("DELEPAT", "Delegacia de Repressão a Crimes Contra o Patrimônio"),
            ("DELEPREV", "Delegacia de Repressão a Crimes Previdenciários"),
            ("DELESP", "Delegacia de Controle de Segurança Privada"),
            ("DELINST", "Delegacia Institucional"),
            ("DMA", "Delegacia de Meio Ambiente"),
            ("DRE", "Delegacia de Repressão a Entorpecentes"),
            ("DREX", "Delegacia Regional Executiva"),
            ("DRPJ", "Delegacia Regional de Polícia Judiciária"),
            ("FORÇA-TAREFA", "Força-Tarefa de Segurança Pública"),
            ("GAB", "Gabinete"),
            ("GAB/SR", "Gabinete da Superintendência Regional"),
            ("GAT", "Grupo de Atuação Tática"),
            ("GID", "Grupo de Identificação de Desastres"),
            ("GINQ", "Grupo de Inquéritos"),
            ("GIP", "Grupo de Investigação de Pessoas"),
            ("GPI", "Grupo de Pronta Intervenção"),
            ("GTED", "Grupo de Treinamento e Educação"),
            ("INVENTARIO", "Comissão de Inventário e Patrimônio"),
            ("NAD", "Núcleo de Administração"),
            ("NEOF", "Núcleo de Operações Financeiras"),
            ("NEPOM", "Núcleo Especial de Polícia Marítima"),
            ("NO", "Núcleo de Operações"),
            ("NTI", "Núcleo de Tecnologia da Informação"),
            ("NUCART", "Núcleo de Cartório"),
            ("NUCRIM", "Núcleo de Criminalística"),
            ("NUMAT", "Núcleo de Material"),
            ("NUPCRIM", "Núcleo de Perícias Técnico-Científicas"),
            ("NUPREV", "Núcleo Previdenciário"),
            ("NUTEL", "Núcleo de Telecomunicações"),
            ("NUTRAN", "Núcleo de Transportes"),
            ("PLANTAO", "Plantão Policial"),
            ("PROTOCOLO", "Protocolo Geral"),
            ("SEADM", "Setor de Administração"),
            ("SELOG", "Setor de Logística"),
            ("SETEC", "Setor Técnico-Científico"),
            ("SIP", "Setor de Inteligência Policial"),
            ("UAMB", "Unidade de Meio Ambiente"),
            ("UTO", "Unidade Tática Operacional"),
        ]
        for sigla, nome in setores_pb:
            sid = f"setor-pb-{sigla.lower().replace('/', '-').replace('ç', 'c')}"
            conn.execute(
                """
                INSERT INTO setores_destino (id, sigla, nome, unidade_pai_sigla, ativo)
                VALUES (?, ?, ?, 'SR/PF/PB', 1)
                ON CONFLICT(sigla) DO NOTHING
                """,
                (sid, sigla, nome),
            )

        # 3. Órgãos e Unidades da PF (R$335 interior, R$380 capitais, R$425 DF/RJ/SP/AM)
        conn.execute("DELETE FROM orgao_unidades WHERE sigla = 'ANP/PF'")
        conn.execute("UPDATE missoes SET unidade_solicitante = 'SR/PF/DF' WHERE unidade_solicitante = 'ANP/PF'")
        conn.execute("UPDATE missoes SET unidade_destino = 'SR/PF/DF' WHERE unidade_destino = 'ANP/PF'")

        unidades = [
            ("unid-pb-01", "SR/PF/PB", "Superintendência Regional na Paraíba", "João Pessoa", "PB", 0, 380.00, "CAPITAIS", "SUPERINTENDENCIA"),
            ("unid-pb-02", "DPF/CGE/PB", "Delegacia de Polícia Federal em Campina Grande/PB", "Campina Grande", "PB", 0, 335.00, "INTERIOR", "DELEGACIA"),
            ("unid-pb-02b", "CGE/PF/PB", "Delegacia de Polícia Federal em Campina Grande/PB", "Campina Grande", "PB", 0, 335.00, "INTERIOR", "DELEGACIA"),
            ("unid-pb-03", "DPF/PAT/PB", "Delegacia de Polícia Federal em Patos/PB", "Patos", "PB", 0, 335.00, "INTERIOR", "DELEGACIA"),
            ("unid-pb-03b", "PAT/PF/PB", "Delegacia de Polícia Federal em Patos/PB", "Patos", "PB", 0, 335.00, "INTERIOR", "DELEGACIA"),
            ("unid-01", "SR/PF/DF", "Superintendência Regional no Distrito Federal", "Brasília", "DF", 0, 425.00, "CAPITAIS_ESPECIAIS", "SUPERINTENDENCIA"),
            ("unid-02", "DGP/PF", "Diretoria de Gestão de Pessoal", "Brasília", "DF", 0, 425.00, "CAPITAIS_ESPECIAIS", "DIRETORIA_DIVISAO"),
            ("unid-03", "SR/PF/AM", "Superintendência Regional no Amazonas", "Manaus", "AM", 0, 425.00, "CAPITAIS_ESPECIAIS", "SUPERINTENDENCIA"),
            ("unid-04", "DPF/CAS/PR", "Delegacia de Polícia Federal em Cascavel/PR", "Cascavel", "PR", 1, 335.00, "INTERIOR", "DELEGACIA"),
            ("unid-05", "DITEC/PF", "Diretoria Técnico-Científica", "Brasília", "DF", 0, 425.00, "CAPITAIS_ESPECIAIS", "DIRETORIA_DIVISAO"),
            ("unid-06", "DLOG/PF", "Diretoria de Logística e Administração", "Brasília", "DF", 0, 425.00, "CAPITAIS_ESPECIAIS", "DIRETORIA_DIVISAO"),
            ("unid-07", "DPF/FPL/MG", "Delegacia de Polícia Federal em Passos/MG", "Passos", "MG", 0, 335.00, "INTERIOR", "DELEGACIA"),
            ("unid-08", "SR/PF/RJ", "Superintendência Regional no Rio de Janeiro", "Rio de Janeiro", "RJ", 0, 425.00, "CAPITAIS_ESPECIAIS", "SUPERINTENDENCIA"),
            ("unid-09", "SR/PF/SP", "Superintendência Regional em São Paulo", "São Paulo", "SP", 0, 425.00, "CAPITAIS_ESPECIAIS", "SUPERINTENDENCIA"),
        ]
        for uid, sigla, nome, mun, uf, front, v_diaria, cat, tipo_unid in unidades:
            existing = conn.execute("SELECT id FROM orgao_unidades WHERE sigla = ?", (sigla,)).fetchone()
            if not existing:
                id_taken = conn.execute("SELECT id FROM orgao_unidades WHERE id = ?", (uid,)).fetchone()
                target_id = uid if not id_taken else f"unid-{uuid.uuid4().hex[:8]}"
                conn.execute(
                    """
                    INSERT INTO orgao_unidades (id, sigla, nome_extenso, municipio, uf, is_fronteira, valor_diaria, categoria_diaria, tipo_unidade, ativo)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """,
                    (target_id, sigla, nome, mun, uf, front, v_diaria, cat, tipo_unid),
                )

        # 4. Cargos da Carreira Policial e Administrativa
        cargos = [
            ("crg-01", "DPF", "Delegado de Polícia Federal", 1),
            ("crg-02", "EPF", "Escrivão de Polícia Federal", 1),
            ("crg-03", "APF", "Agente de Polícia Federal", 1),
            ("crg-04", "PPF", "Papiloscopista Policial Federal", 1),
            ("crg-05", "PCF", "Perito Criminal Federal", 1),
            ("crg-06", "ADM", "Servidor Administrativo (PECPF)", 0),
        ]
        for cid, sigla, desc, pol in cargos:
            conn.execute(
                """
                INSERT INTO cargos (id, sigla, descricao, is_carreira_policial)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(sigla) DO NOTHING
                """,
                (cid, sigla, desc, pol),
            )

        # 5. Tipos de Missão
        tipos = [
            ("tp-01", "Ensino e Capacitação", "Cursos de formação, treinamentos contínuos e instruções táticas"),
            ("tp-02", "Operacional / Repressão", "Operações policiais repressivas, mandados judiciais e patrulhamento"),
            ("tp-03", "Perícia Oficial", "Exames periciais de campo, locais de crime e desastres em massa"),
            ("tp-04", "Inteligência e Investigação", "Diligências sigilosas e ações de inteligência de campo"),
            ("tp-05", "Corregedoria e Correição", "Vistorias, correições ordinárias e sindicâncias"),
            ("tp-06", "Administrativa e Logística", "Escolta de armamentos, manutenção e apoio logístico"),
        ]
        for tid, nome, desc in tipos:
            conn.execute(
                """
                INSERT INTO tipos_missao (id, nome, descricao, ativo)
                VALUES (?, ?, ?, 1)
                ON CONFLICT(nome) DO NOTHING
                """,
                (tid, nome, desc),
            )

        # 6. Papéis de Missão
        papeis = [
            ("pap-01", "Coordenador de Missão", "Líder e responsável formal pela equipe"),
            ("pap-02", "Professor / Instrutor", "Docente ou instrutor técnico designado"),
            ("pap-03", "Operador Tático", "Execução de mandados e ações táticas de campo"),
            ("pap-04", "Perito de Campo", "Peritagens e laudos periciais externos"),
            ("pap-05", "Apoio Cartorário", "Lavratura de autos e termos cartorários"),
            ("pap-06", "Apoio Logístico", "Condução de viaturas e suporte operacional"),
            ("pap-07", "Missionário Individual", "Executor exclusivo de missão individual"),
        ]
        for pid, nome, desc in papeis:
            conn.execute(
                """
                INSERT INTO papeis_missao (id, nome, descricao)
                VALUES (?, ?, ?)
                ON CONFLICT(nome) DO NOTHING
                """,
                (pid, nome, desc),
            )


if __name__ == "__main__":
    print("[SEED] Inicializando base de dados limpa (somente usuários iniciais e tabelas institucionais)...")
    seed_database()
    print("[SEED] Base de dados inicializada com sucesso e livre de dados fictícios!")
