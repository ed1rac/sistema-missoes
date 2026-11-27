# Sistema de Controle de Diárias e Passagens (SIS-MISSÕES PF)

[![Stack](https://img.shields.io/badge/Stack-FastAPI%20%7C%20Pydantic%20v2%20%7C%20SQLite%20%7C%20Docker-blue.svg)]()
[![Porta](https://img.shields.io/badge/Porta%20Padr%C3%A3o-5179-gold.svg)]()

Plataforma web corporativa para planejamento, designação, controle financeiro de diárias e passagens aéreas, prestação de contas e auditoria de missões e servidores da Polícia Federal.

---

## 1. Implantação em Servidor Linux via Docker (Produção)

No ambiente de produção Linux, o sistema é executado exclusivamente em container Docker na porta **`5179`**, com persistência de banco SQLite montada em `./app/data/missoes.db`.

### Pré-requisitos no Servidor Linux
- Docker Engine (`>= 24.x`)
- Docker Compose v2 (`docker compose`)
- Git

### Passo a Passo de Subida

1. **Clonar o repositório:**
   ```bash
   git clone https://github.com/ed1rac/sistema-missoes.git
   cd sistema-missoes
   ```

2. **Configurar variáveis de ambiente (recomendado em produção):**
   ```bash
   cp .env.example .env
   ```
   Edite o arquivo `.env` e defina uma chave forte para `JWT_SECRET` (exemplo para gerar no Linux):
   ```bash
   openssl rand -hex 32
   ```

3. **Construir e iniciar o container:**
   ```bash
   docker compose up -d --build
   ```

4. **Verificar saúde e logs:**
   ```bash
   docker compose ps
   docker compose logs -f
   ```

5. **Endereços de Acesso (Porta `5179`):**
   - **Aplicação Web:** `http://<IP_OU_HOST_DO_SERVIDOR>:5179`
   - **Documentação OpenAPI / Swagger:** `http://<IP_OU_HOST_DO_SERVIDOR>:5179/docs`
   - **ReDoc:** `http://<IP_OU_HOST_DO_SERVIDOR>:5179/redoc`
   - **Healthcheck:** `http://<IP_OU_HOST_DO_SERVIDOR>:5179/api/health`

### Comandos Operacionais de Manutenção
```bash
# Reiniciar serviço (senhas e dados em ./app/data/missoes.db são preservados)
docker compose restart

# Parar containers
docker compose down

# Backup rápido do banco SQLite
cp app/data/missoes.db "backup_missoes_$(date +%Y%m%d_%H%M%S).db"
```

---

## 2. Banco Saneado, Usuários Padrão e Troca Obrigatória de Senhas

O banco de dados inicial é criado automaticamente no primeiro boot **totalmente saneado**, **sem nenhum dado mockado** (zero servidores fictícios, zero missões de exemplo e zero logs prévios). Apenas as tabelas de domínio institucional (unidades da PF, setores da SR/PF/PB, faixas de diárias, cargos, tipos e papéis de missão) e os usuários iniciais de acesso são provisionados.

### Usuários e Senhas-Padrão Iniciais

| Usuário (`username`) | Senha Inicial | Perfil RBAC | Nível de Acesso / Finalidade |
|---|---|---|---|
| **`edkallenn`** | **`123456`** | **`ADMIN` (Master)** | Usuário Master com controle administrativo total do sistema, usuários, unidades e aprovações. |
| **`admin`** | **`123456`** | **`ADMIN` (Master)** | Administrador Geral do sistema para configuração inicial e contingência. |
| **`cadastrador`** | **`123456`** | **`CADASTRADOR`** | Cadastro e edição de servidores e recrutamentos (sem permissão para aprovar ou emitir OM/PCDP). |
| **`gerencial`** | **`123456`** | **`GERENCIAL`** | Consulta completa a painéis, gráficos, relatórios, exportações e trilha de auditoria (somente leitura). |

> **AVISO CRÍTICO DE SEGURANÇA:**
> **Após subir os containers, TODAS as senhas padrão (`123456`) acima DEVEM ser trocadas imediatamente**, antes de liberar o acesso a outros usuários na rede.
> Além disso, altere o `JWT_SECRET` no `.env` antes de iniciar o ambiente produtivo (a troca de `JWT_SECRET` invalida tokens antigos).

### Sugestões de Alteração de Senhas
- Substitua `123456` por senhas individuais fortes com **no mínimo 12 caracteres**, combinando letras maiúsculas, minúsculas, números e símbolos especiais (ex.: `Pf#Pb!2026$Adm9x`, nunca reutilize a mesma senha entre os perfis).
- Caso algum perfil operacional (`admin`, `cadastrador` ou `gerencial`) não seja necessário imediatamente, altere sua senha e, se desejar, desative-o em **Gestão de Usuários**.
- O processo de seed (`app/seed.py`) utiliza inserção não destrutiva (`ON CONFLICT DO NOTHING`): após alterar as senhas e parâmetros no sistema, **reinícios futuros do container Docker não sobrescreverão suas novas senhas**.

### Como Trocar Todas as Senhas Após Subir os Containers

**Opção A — Pela Interface Web (Recomendado):**
1. Acesse `http://<SERVIDOR>:5179` e entre com `edkallenn` / `123456`.
2. No menu lateral, abra **Gestão de Usuários**.
3. Clique no botão **Senha** em cada uma das contas (`edkallenn`, `admin`, `cadastrador`, `gerencial`) e defina uma nova senha forte para cada uma.
4. Saia do sistema (**Desconectar**) e valide o login com a nova senha de `edkallenn`.

**Opção B — Via API REST (`curl` no servidor Linux):**
```bash
# 1. Obter token de administrador
TOKEN=$(curl -s -X POST http://localhost:5179/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"edkallenn","password":"123456"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. Redefinir senha de cada usuário padrão
for USER in edkallenn admin cadastrador gerencial; do
  read -rsp "Nova senha para ${USER}: " NOVA_SENHA; echo
  curl -s -X POST "http://localhost:5179/api/usuarios/${USER}/reset-password" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"new_password\":\"${NOVA_SENHA}\"}"
  echo
done
```

---

## 3. Principais Funcionalidades

- **Gestão de Recrutamento (Individual e em Equipe):** cadastro simplificado ou completo com detecção automática de conflitos de agenda entre missões concorrentes.
- **Cálculo Regulamentar de Diárias e Passagens:**
  - $N$ dias ($N > 1$): $(N - 0{,}5) \times \text{valor da diária}$.
  - $1$ dia (retorno no mesmo dia): $0{,}5 \times \text{valor da diária}$.
  - Servidor lotado na sede de destino (`is_missao_sede = True` ou `is_missionario_geral = False`): isenção automática de diárias ($R\$\ 0{,}00$).
  - Valores de referência configuráveis por faixa (`INTERIOR` R$ 335,00, `CAPITAIS` R$ 380,00, `CAPITAIS_ESPECIAIS` R$ 425,00) e campo editável por missão (`PATCH /api/missoes/{id}/valor-diaria`) com recálculo em lote.
- **Ciclo de Vida com 11 Status Oficiais:**
  `Indicado` → `Pendente de Alocação` → `SAT pendente` → `SAT Atendida` / `SAT Recusada` / `SAT Reiterada` → `OM EMITIDA` → `PCDP CADASTRADA` → `PCDP ENCAMINHADA` → `PCDP PRESTAR CONTAS` → `Concluído`.
- **Dashboard Executivo e Alertas Proativos:** filtros dinâmicos por período, unidade da PB (`SR/PF/PB`, `DPF/CGE/PB`, `DPF/PAT/PB`), setor, cargo, transporte e status; alertas de PCDP próxima, prestação de contas em atraso, conflitos de agenda e emissão de bilhete aéreo (17 dias).
- **Trilha Imutável de Auditoria (`audit_logs`):** registro de logons, falhas de autenticação, alterações cadastrais, mudanças de status e exportações com horário oficial de Brasília (`America/Sao_Paulo`).
- **Interoperabilidade:** exportação autenticada para **Excel (`.xlsx`)**, **CSV (`UTF-8` com BOM)** e **JSON**.

---

## 4. Testes Automatizados

A suíte automatizada utiliza `pytest` com banco SQLite temporário isolado por execução (sem alterar dados de produção):

```bash
pytest -v
```

Principais módulos de teste em `tests/`:
- `tests/test_production_seed.py`: saneamento do banco de produção, presença dos usuários padrão (`edkallenn`, `admin`, `cadastrador`, `gerencial`), preservação de senhas/configurações entre reinícios e operação com banco vazio.
- `tests/test_auth.py`: autenticação JWT, perfis e proteção de rotas.
- `tests/test_calculator.py`: fórmula oficial de diárias, isenção de sede e validação de datas.
- `tests/test_missoes.py`: ciclo de vida, recálculo dinâmico de diárias e detecção de conflitos.
- `tests/test_servidores.py`: CRUD de efetivo, filtros e inativação lógica.
- `tests/test_rbac_and_features.py`: matriz RBAC, gestão de usuários, auditoria BRT e CRUD de unidades.
- `tests/test_novas_regras.py`: faixas de diárias, setores PB, status oficiais, filtros e alertas aéreos.
- `tests/test_apontamentos_pdf.py`: CPF opcional, login vazio, sincronização de passagens/transporte e assets da interface.
- `tests/test_export.py`: exportações `.csv`, `.xlsx`, `.json` e dashboard.

---

## 5. Estrutura do Projeto

```text
sistema-missoes/
├── app/
│   ├── __init__.py
│   ├── audit.py               # Registro imutável de auditoria (America/Sao_Paulo)
│   ├── auth.py                # Hashing Bcrypt, tokens JWT e dependências RBAC
│   ├── calculator.py          # Cálculo regulamentar de diárias e custos
│   ├── config.py              # Configurações (porta 5179, caminhos, JWT)
│   ├── database.py            # Conexão SQLite, schema DDL e migrações idempotentes
│   ├── main.py                # Aplicação FastAPI e servidor SPA
│   ├── schemas.py             # Modelos Pydantic v2
│   ├── seed.py                # Seed saneado (usuários iniciais + tabelas institucionais)
│   ├── status_utils.py        # Normalização e filtragem dos 11 status oficiais
│   ├── routers/
│   │   ├── audit.py           # Consulta de logs (/api/audit)
│   │   ├── auth.py            # Autenticação (/api/auth)
│   │   ├── config.py          # Parâmetros globais (/api/config)
│   │   ├── dashboard.py       # Indicadores, gráficos e alertas (/api/dashboard)
│   │   ├── export.py          # Exportação XLSX, CSV e JSON (/api/export)
│   │   ├── missoes.py         # Missões, participantes, unidades e setores (/api/missoes)
│   │   ├── servidores.py      # Cadastro de servidores (/api/servidores)
│   │   └── usuarios.py        # Administração de usuários e senhas (/api/usuarios)
│   ├── static/
│   │   ├── index.html         # Interface SPA
│   │   ├── app.js             # Lógica de frontend
│   │   └── styles.css         # Estilos e temas
│   └── data/
│       └── .gitkeep           # Diretório persistente para missoes.db
├── tests/                     # Suíte de testes automatizados (pytest)
├── .dockerignore
├── .env.example
├── .gitattributes
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── pytest.ini
├── requirements.txt
├── run.py
└── README.md
```
