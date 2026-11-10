# SIS-MISSÕES PF (v2.0)
## Sistema Integrado de Gestão e Controle de Missões e Servidores da Polícia Federal

[![Status](https://img.shields.io/badge/Status-Produção_Ready-emerald.svg)]()
[![Stack](https://img.shields.io/badge/Stack-FastAPI%20%7C%20Pydantic%20v2%20%7C%20SQLite%2FPostgres%20%7C%20Tailwind-blue.svg)]()
[![Testes](https://img.shields.io/badge/Testes-24%2F24%20Passando%20(100%25)-brightgreen.svg)]()
[![Porta](https://img.shields.io/badge/Porta%20Padrão-5179-gold.svg)]()

---

### Sumário Executivo

O **SIS-MISSÕES PF** é a nova plataforma institucional corporativa para planejamento, designação, controle financeiro, prestação de contas e auditoria de missões e servidores da Polícia Federal em todo o território nacional.

Este sistema foi construído a partir do zero em substituição ao antigo aplicativo departamental monousuário da ANP, transformando um fluxo manual e desconectado em uma **solução Web moderna, multiusuário, auditável, de alta performance e pronta para uso imediato**.

---

## 1. Por que este Sistema é Muito Superior ao Anterior?

| Dimensão Avaliada | Sistema Legado (Legado Desktop) | Novo SIS-MISSÕES PF (v2.0) |
|---|---|---|
| **Modelo Conceitual** | Estritamente restrito a **"Instrutor"** da ANP. Todo policial era cadastrado como se fosse professor. | Conceito centralizado de **SERVIDOR** (DPF, PCF, APF, EPF, PPF, ADM). Papéis (coordenador, instrutor, perito, operador) são dinâmicos por missão. |
| **Entidade Missão** | Propriedade embutida e subordinada dentro do cadastro do instrutor (desnormalizada, redundante e inconsistente). | **Entidade de 1ª Classe independente**: possui código institucional único, fluxo administrativo formal (OM, SAT, PCDP, Processo SEI) e equipe $N:M$. |
| **Valor da Diária** | Fixo ou embutido no código, sem possibilidade de ajuste operacional flexível. | **CAMPO EDITÁVEL DA DIÁRIA:** Permite alterar o valor base da diária em nível de sistema, por missão e por participante, com **recalculo dinâmico instantâneo** de todos os totais. |
| **Fórmula de Diárias** | Cálculos manuais ou fórmulas estáticas sem transparência. | Regra oficial regulamentar automatizada: **$(N - 0{,}5) \times \text{diária}$** com dedução de meia-diária no retorno e **isenção total ($R\$\ 0{,}00$)** para servidores lotados na sede da missão. |
| **Conflito de Agendas** | Inexistente. Um policial podia ser alocado em três missões simultâneas sem qualquer aviso. | **Motor Preditivo de Conflitos**: bloqueia ou alerta sobreposição de datas do servidor em missões concorrentes. |
| **Gestão de Passagens** | Desconectada de diárias e sem controle de localizadores. | Controle integrado de passagens aéreas, número de e-ticket, localizador e custos operacionais adicionais. |
| **Central de Alertas** | Nenhuma. Gestores esqueciam prazos de PCDP e prestação de contas. | **Alertas Proativos**: missões prestes a iniciar sem PCDP tramitada no SCDP e missões com prestação de contas em atraso (> 5 dias). |
| **Arquitetura & Acesso** | Aplicação desktop monousuário presa a um único computador. | **100% Web SPA Responsiva**, multiusuário, com controle RBAC (Admin, Gestor, Servidor), segura e compatível com desktops e dispositivos móveis. |
| **Auditoria e Compliance** | Sem qualquer rastreabilidade de quem alterou o quê. | **Trilha Imutável de Auditoria (`audit_logs`)** registrando login, IP, operador, ação e diff JSONB de alterações (atendimento LGPD). |
| **Interoperabilidade** | Exportações quebradas ou rudimentares. | Exportação em tempo real para **Excel (.xlsx estilizado multiabas)**, **CSV (UTF-8 com BOM)** e **JSON Canônico**. |

---

## 2. Credenciais de Acesso e Usuários Mestres (Ready-to-Use)

O sistema já é inicializado automaticamente com os usuários mestres cadastrados e ativos:

| Login / Usuário | Senha Padrão | Nível de Privilégio | Finalidade |
|---|---|---|---|
| **`admin`** | **`123456`** | **`ADMIN` (Master)** | Administração geral do sistema, parâmetros globais e controle total. |
| **`edkallenn`** | **`123456`** | **`ADMIN` (Master)** | Usuário Master solicitado para operação e homologação completa. |

---

## 3. Inicialização Rápida e Execução

### Porta Padrão: `5179`
O sistema roda por padrão na porta **`5179`**, conforme especificado:
- **Interface Web:** `http://localhost:5179`
- **Documentação Interativa OpenAPI / Swagger:** `http://localhost:5179/docs`
- **Documentação Alternativa ReDoc:** `http://localhost:5179/redoc`
- **Healthcheck:** `http://localhost:5179/api/health`

### Método A: Execução Direta via Python (Recomendado para Desenvolvimento)

1. Certifique-se de estar na pasta do projeto:
   ```bash
   cd d:\SHARED\projetos\sistema-missoes\sistema-missoes-novo
   ```

2. Instale as dependências (caso não estejam instaladas):
   ```bash
   pip install -r requirements.txt
   ```

3. Inicie o servidor com o script `run.py`:
   ```bash
   python run.py
   ```

4. Abra o navegador em:
   ```
   http://localhost:5179
   ```

---

### Método B: Execução via Docker / Docker Compose

O ecossistema é 100% conteinerizado com persistência de dados em volume nomeado:

```bash
cd d:\SHARED\projetos\sistema-missoes\sistema-missoes-novo
docker compose up -d --build
```

Para visualizar logs:
```bash
docker compose logs -f
```

---

## 4. O Campo Editável da Diária e Recálculo Dinâmico

Uma das inovações centrais é a flexibilidade do valor da diária:

1. **Diária Padrão do Sistema:**
   - Configurada globalmente em `/api/config` (padrão institucional de R$ 425,00).
   - Pode ser atualizada a qualquer momento na aba **Parâmetros & Diária**.

2. **Campo Editável na Missão:**
   - Na tela de detalhes de qualquer missão, há o componente em destaque **"Campo Editável da Diária da Missão"**.
   - O gestor pode alterar o valor (ex: de R$ 425,00 para R$ 480,00 ou R$ 500,00 em razão de localidade remota ou instrução especializada).
   - Ao clicar em **"Recalcular Diárias"**, o sistema dispara o endpoint `PATCH /api/missoes/{id}/valor-diaria`:
     - O valor unitário é atualizado.
     - **Todos os participantes da missão são recalculados imediatamente**, aplicando a dedução de 0,5 diária e atualizando o custo geral da missão.

3. **Diária Customizada por Participante:**
   - Permite que um participante específico tenha uma diária diferenciada por decisão fundamentada.

---

## 5. Regras Institucionais de Cálculo Financeiro

### Fórmula Oficial Aplicada
- Para $N$ dias ($N > 1$):
  $$\text{Qtd Diárias} = N - 0{,}5$$
  *(Dedução de meia diária referente ao dia do retorno).*
- Para 1 dia:
  $$\text{Qtd Diárias} = 0{,}5$$
- Servidor Lotado na Sede da Missão (`is_missao_sede = True`):
  $$\text{Qtd Diárias} = 0{,}0 \quad \text{e} \quad \text{Valor Total} = R\$\ 0{,}00$$
- Valor Total de Diárias:
  $$\text{Total Diárias} = \text{Qtd Diárias} \times \text{Valor Unitário}$$
- Custo Consolidado do Servidor:
  $$\text{Custo Total} = \text{Total Diárias} + \text{Passagem Aérea} + \text{Outros Custos}$$

---

## 6. Ciclo de Vida da Missão (Máquina de Estados)

O sistema guia o processo administrativo através dos 9 estados formais:
1. `RASCUNHO`: Planejamento inicial da missão.
2. `SOLICITADA`: Submissão à chefia da unidade.
3. `APROVADA`: Homologação da oportunidade e conveniência.
4. `OM_EMITIDA`: Geração formal da Ordem de Missão.
5. `PCDP_TRAMITADA`: Cadastramento no SCDP do Governo Federal.
6. `EM_ANDAMENTO`: Efetivo em trânsito ou no local de execução.
7. `PRESTACAO_CONTAS`: Encerramento das atividades e cobrança de bilhetes/relatórios.
8. `CONCLUIDA`: Prestação de contas aprovada.
9. `CANCELADA`: Revogação motivada por necessidade do serviço.

---

## 7. Bateria de Testes Automatizados (24/24 Passando)

A suíte de testes com `pytest` cobre todas as camadas do sistema:
- `tests/test_calculator.py`: Validação matemática de diárias, dedução de retorno, isenção de sede e validação de datas.
- `tests/test_auth.py`: Autenticação dos usuários `admin` e `edkallenn`, tokens JWT e proteção de rotas.
- `tests/test_missoes.py`: Ciclo de vida, campo editável da diária, recálculo dinâmico e bloqueio de conflitos de agenda.
- `tests/test_servidores.py`: CRUD de servidores, filtros por cargo e inativação lógica.
- `tests/test_export.py`: Exportações CSV (BOM), Excel (.xlsx multiabas) e JSON.

### Como Executar os Testes:
```bash
cd d:\SHARED\projetos\sistema-missoes\sistema-missoes-novo
pytest -v
```

---

## 8. Estrutura de Diretórios do Projeto

```
sistema-missoes-novo/
├── app/
│   ├── __init__.py
│   ├── config.py              # Configurações globais (Porta 5179, DB, JWT)
│   ├── database.py            # Conexão e DDL SQLite/Postgres com PRAGMA foreign_keys
│   ├── models.py / schemas.py # DTOs Pydantic v2 com validação estrita
│   ├── auth.py                # Autenticação Bcrypt e tokens JWT
│   ├── calculator.py          # Regras e fórmulas institucionais de diárias PF
│   ├── audit.py               # Gravador imutável de trilha de auditoria
│   ├── seed.py                # Auto-seed de usuários master, unidades e dados canônicos
│   ├── main.py                # Ponto de entrada FastAPI e montagem de SPA
│   ├── routers/
│   │   ├── auth.py            # Login e perfil (/api/auth)
│   │   ├── servidores.py      # Efetivo e servidores (/api/servidores)
│   │   ├── missoes.py         # Gestão de missões, participantes e diária (/api/missoes)
│   │   ├── dashboard.py       # Painel executivo e alertas (/api/dashboard)
│   │   ├── export.py          # Exportação Excel, CSV, JSON (/api/export)
│   │   ├── config.py          # Parâmetros (/api/config)
│   │   └── audit.py           # Logs de conformidade (/api/audit)
│   ├── static/
│   │   ├── index.html         # Single Page Application institucional
│   │   ├── app.js             # Controlador dinâmico da interface
│   │   └── styles.css         # Estilização corporativa e badges
│   └── data/
│       └── missoes.db         # Banco relacional local pronto para uso
├── tests/
│   ├── conftest.py            # Fixtures de banco isolado e tokens
│   ├── test_calculator.py     # Testes da fórmula de diárias
│   ├── test_auth.py           # Testes de autenticação
│   ├── test_missoes.py        # Testes de missões e diária editável
│   ├── test_servidores.py     # Testes de efetivo
│   └── test_export.py         # Testes de relatórios
├── Dockerfile                 # Imagem Python 3.13-slim
├── docker-compose.yml         # Orquestração com volume persistente
├── pytest.ini                 # Configuração do pytest
├── requirements.txt           # Dependências de produção
├── run.py                     # Script de inicialização na porta 5179
└── README.md                  # Manual completo
```
