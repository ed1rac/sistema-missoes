/**
 * SIS-MISSÕES PF - Frontend Application v2.1
 * Plataforma Corporativa de Controle de Missões e Servidores
 * Polícia Federal • DPF / Paraíba
 */

const API_BASE = "";
let CURRENT_USER = null;
let CURRENT_VIEW = "dashboard";
let SYSTEM_CONFIG = {};
let DASHBOARD_VIEW = "graficos"; // "graficos" | "tabela" | "kanban"
let DASHBOARD_FILTERS = {
  ano: "2026",
  mes: "",
  bimestre: "",
  trimestre: "",
  semestre: "",
  status: "",
  modalidade: "",
  tipo: "",
  unidade: "",
  cargo: "",
  setor: "",
  meio_transporte: "",
  unidade_pb: "",
  data_de: "",
  data_ate: ""
};
let CHART_INSTANCES = {};
let METADATA_CACHE = {
  tipos: [],
  unidades: [],
  cargos: [],
  papeis: [],
  setores: [],
  valoresDiarias: []
};

// ==============================================================================
// UTILITÁRIOS DE API E FORMATAÇÃO
// ==============================================================================
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${url}`, { ...options, headers });
  if (response.status === 401) {
    logout();
    throw new Error("Sessão expirada. Faça login novamente.");
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Erro HTTP ${response.status}`);
  }
  return response.json();
}

function formatMoney(val) {
  const num = parseFloat(val || 0);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBR(dateStr) {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function getStatusBadgeClass(status) {
  if (!status) return "badge-RASCUNHO";
  const norm = String(status).trim().toUpperCase().replace(/[\s\/-]+/g, '_');
  return `badge-${norm}`;
}

// ==============================================================================
// GESTÃO DE TEMAS VISUAIS (AZUL PF, GOV CLARO, BLACK OPS, ESMERALDA, AMBER, CYBER, PLATINA)
// ==============================================================================
const VALID_THEMES = ["azul-pf", "gov-claro", "black-ops", "esmeralda-fed", "amber-safari", "cyber-indigo", "cinza-platina"];

function setTheme(themeName) {
  VALID_THEMES.forEach(t => document.body.classList.remove(`theme-${t}`));
  if (!VALID_THEMES.includes(themeName)) {
    themeName = "azul-pf";
  }
  document.body.classList.add(`theme-${themeName}`);
  localStorage.setItem("pf_theme", themeName);

  document.querySelectorAll(".theme-btn").forEach(btn => btn.classList.remove("active-theme"));
  const activeBtn = document.getElementById(`btn-theme-${themeName}`);
  if (activeBtn) activeBtn.classList.add("active-theme");
}

function applyStoredTheme() {
  const saved = localStorage.getItem("pf_theme") || "azul-pf";
  setTheme(saved);
}

// ==============================================================================
// INICIALIZAÇÃO DA APLICAÇÃO
// ==============================================================================
document.addEventListener("DOMContentLoaded", async () => {
  applyStoredTheme();
  setupLoginEvents();
  const token = localStorage.getItem("token");
  if (token) {
    try {
      CURRENT_USER = await apiFetch("/api/auth/me");
      updateUserInfo();
      await loadSystemConfig();
      await loadMetadata();
      navigate("dashboard");
    } catch (e) {
      console.warn("Token inválido, solicitando login", e);
      showLoginModal(true);
    }
  } else {
    showLoginModal(true);
  }
});

function showLoginModal(show) {
  const modal = document.getElementById("login-modal");
  if (show) {
    modal.classList.remove("hidden");
  } else {
    modal.classList.add("hidden");
  }
}

function setupLoginEvents() {
  const form = document.getElementById("form-login");
  const alertEl = document.getElementById("login-alert");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    alertEl.classList.add("hidden");

    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;

    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      localStorage.setItem("token", res.access_token);
      CURRENT_USER = res.user;
      updateUserInfo();
      showLoginModal(false);
      await loadSystemConfig();
      await loadMetadata();
      navigate("dashboard");
    } catch (err) {
      alertEl.textContent = err.message || "Credenciais inválidas.";
      alertEl.classList.remove("hidden");
    }
  });
}

function logout() {
  localStorage.removeItem("token");
  CURRENT_USER = null;
  showLoginModal(true);
}

function updateUserInfo() {
  if (!CURRENT_USER) return;
  document.getElementById("user-display-name").textContent = CURRENT_USER.full_name || CURRENT_USER.username;
  document.getElementById("user-display-role").textContent = CURRENT_USER.role;
  document.getElementById("user-avatar").textContent = (CURRENT_USER.username || "PF").slice(0, 2).toUpperCase();

  // Controle de visibilidade de menus por RBAC
  const navUsuarios = document.getElementById("nav-usuarios");
  if (navUsuarios) {
    if (CURRENT_USER.role === "ADMIN") {
      navUsuarios.classList.remove("hidden");
    } else {
      navUsuarios.classList.add("hidden");
    }
  }
}

async function loadSystemConfig() {
  try {
    const configs = await apiFetch("/api/config");
    configs.forEach(c => {
      SYSTEM_CONFIG[c.chave] = c.valor;
    });
    const headerDiaria = document.getElementById("header-diaria-val");
    if (headerDiaria && SYSTEM_CONFIG.valor_diaria_padrao) {
      headerDiaria.textContent = formatMoney(SYSTEM_CONFIG.valor_diaria_padrao);
    }
  } catch (err) {
    console.error("Erro ao carregar configurações", err);
  }
}

async function loadMetadata() {
  try {
    const [tipos, unidades, cargos, papeis, setores, valoresDiarias] = await Promise.all([
      apiFetch("/api/missoes/meta/tipos"),
      apiFetch("/api/missoes/meta/unidades"),
      apiFetch("/api/missoes/meta/cargos"),
      apiFetch("/api/missoes/meta/papeis"),
      apiFetch("/api/missoes/meta/setores").catch(() => []),
      apiFetch("/api/missoes/meta/valores-diarias").catch(() => [])
    ]);
    METADATA_CACHE.tipos = tipos;
    METADATA_CACHE.unidades = unidades;
    METADATA_CACHE.cargos = cargos;
    METADATA_CACHE.papeis = papeis;
    METADATA_CACHE.setores = setores;
    METADATA_CACHE.valoresDiarias = valoresDiarias;
  } catch (err) {
    console.error("Erro ao carregar metadados", err);
  }
}

// ==============================================================================
// NAVEGAÇÃO ENTRE VISTAS
// ==============================================================================
function navigate(viewName) {
  CURRENT_VIEW = viewName;
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
  const activeBtn = document.getElementById(`nav-${viewName}`);
  if (activeBtn) activeBtn.classList.add("active");

  const container = document.getElementById("view-container");
  const titles = {
    dashboard: "Painel Executivo de Missões",
    missoes: "Gestão Corporativa de Missões",
    custos: "Custos por Missão e Servidor / Missionário",
    servidores: "Cadastro Integrado de Servidores da PF",
    "diarias-calc": "Simulador Oficial de Diárias (Legislação PF)",
    exportar: "Módulo de Interoperabilidade e Exportação",
    auditoria: "Trilha Imutável de Auditoria (Compliance)",
    usuarios: "Administração de Usuários e Perfis RBAC",
    unidades: "Cadastro de Unidades Solicitantes & Destino (PF)",
    config: "Parâmetros Gerais do Sistema e Diária Base"
  };
  document.getElementById("page-title").textContent = titles[viewName] || "SIS-MISSÕES PF";

  // Destruir gráficos anteriores se houver
  destroyCharts();

  switch (viewName) {
    case "dashboard":
      renderDashboard(container);
      break;
    case "missoes":
      renderMissoes(container);
      break;
    case "custos":
      renderCustos(container);
      break;
    case "servidores":
      renderServidores(container);
      break;
    case "diarias-calc":
      renderDiariasCalculator(container);
      break;
    case "exportar":
      renderExportar(container);
      break;
    case "auditoria":
      renderAuditoria(container);
      break;
    case "usuarios":
      renderUsuarios(container);
      break;
    case "unidades":
      renderUnidades(container);
      break;
    case "config":
      renderConfig(container);
      break;
    default:
      container.innerHTML = `<p class="text-slate-400">Página em construção.</p>`;
  }
}

function destroyCharts() {
  Object.keys(CHART_INSTANCES).forEach(key => {
    if (CHART_INSTANCES[key]) {
      CHART_INSTANCES[key].destroy();
      delete CHART_INSTANCES[key];
    }
  });
}

function closeModal() {
  document.getElementById("modal-container").classList.add("hidden");
}

// ==============================================================================
// 1. DASHBOARD DINÂMICO (GRÁFICOS CHART.JS, TABELA E KANBAN)
// ==============================================================================
// ==============================================================================
// 1. DASHBOARD DINÂMICO (GRÁFICOS CHART.JS, TABELA E KANBAN COM FILTROS HOT)
// ==============================================================================
async function renderDashboard(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando painel executivo com filtros inteligentes...</div>`;

  try {
    const qParams = new URLSearchParams();
    if (DASHBOARD_FILTERS.ano) qParams.append("ano", DASHBOARD_FILTERS.ano);
    if (DASHBOARD_FILTERS.mes) qParams.append("mes", DASHBOARD_FILTERS.mes);
    if (DASHBOARD_FILTERS.bimestre) qParams.append("bimestre", DASHBOARD_FILTERS.bimestre);
    if (DASHBOARD_FILTERS.trimestre) qParams.append("trimestre", DASHBOARD_FILTERS.trimestre);
    if (DASHBOARD_FILTERS.semestre) qParams.append("semestre", DASHBOARD_FILTERS.semestre);
    if (DASHBOARD_FILTERS.status) qParams.append("status", DASHBOARD_FILTERS.status);
    if (DASHBOARD_FILTERS.modalidade) qParams.append("modalidade", DASHBOARD_FILTERS.modalidade);
    if (DASHBOARD_FILTERS.tipo) qParams.append("tipo", DASHBOARD_FILTERS.tipo);
    if (DASHBOARD_FILTERS.unidade) qParams.append("destino", DASHBOARD_FILTERS.unidade);
    if (DASHBOARD_FILTERS.cargo) qParams.append("cargo", DASHBOARD_FILTERS.cargo);
    if (DASHBOARD_FILTERS.setor) qParams.append("setor", DASHBOARD_FILTERS.setor);
    if (DASHBOARD_FILTERS.meio_transporte) qParams.append("meio_transporte", DASHBOARD_FILTERS.meio_transporte);
    if (DASHBOARD_FILTERS.unidade_pb) qParams.append("unidade_pb", DASHBOARD_FILTERS.unidade_pb);
    if (DASHBOARD_FILTERS.data_de) qParams.append("data_de", DASHBOARD_FILTERS.data_de);
    if (DASHBOARD_FILTERS.data_ate) qParams.append("data_ate", DASHBOARD_FILTERS.data_ate);

    const qs = qParams.toString() ? `?${qParams.toString()}` : "";
    const summary = await apiFetch(`/api/dashboard/summary${qs}`);
    const missoes = await apiFetch(`/api/missoes${qs}`);

    let alertsHtml = "";
    if (summary.alertas && summary.alertas.length > 0) {
      alertsHtml = `
        <div class="mb-5 space-y-2">
          ${summary.alertas.map(a => `
            <div class="p-3.5 rounded-xl border flex items-start space-x-3 ${a.tipo === 'PERIGO' ? 'bg-red-950/50 border-red-800 text-red-200' : 'bg-amber-950/50 border-amber-800 text-amber-200'}">
              <svg class="w-5 h-5 shrink-0 mt-0.5 text-pf-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              <div class="flex-1 text-xs">
                <span class="font-bold uppercase tracking-wider">${a.titulo}:</span>
                <span class="ml-1">${a.mensagem}</span>
                ${a.servidores_nomes && a.servidores_nomes.length ? `
                  <div class="mt-1.5 flex flex-wrap gap-1">
                    <span class="text-[11px] font-semibold text-slate-300">Servidores Notificados:</span>
                    ${a.servidores_nomes.map(n => `<span class="bg-slate-900 border border-slate-700 text-white font-semibold px-2 py-0.5 rounded text-[10px]">${n}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
              ${a.missao_codigo ? `<button onclick="openMissaoDetail('${a.missao_codigo}')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-white transition">Ver Missão</button>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="space-y-6 animate-fade-in">
        
        <!-- BARRA SUPERIOR DE FILTROS AVANÇADOS (TODOS HOT - FILTRAM IMEDIATAMENTE) -->
        <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center space-x-2">
              <svg class="w-4 h-4 text-pf-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>
              <h3 class="text-xs font-bold text-white uppercase tracking-wider">Filtros Dinâmicos (HOT - Atualização Instantânea)</h3>
            </div>
            <!-- SELETOR DE VISÕES DO DASHBOARD -->
            <div class="flex items-center bg-slate-900 border border-slate-700 rounded-xl p-1 space-x-1 text-xs">
              <button onclick="setDashboardView('graficos')" class="px-3 py-1.5 rounded-lg font-semibold transition ${DASHBOARD_VIEW === 'graficos' ? 'bg-pf-700 text-white shadow' : 'text-slate-400 hover:text-white'}">
                📊 Gráficos & KPIs
              </button>
              <button onclick="setDashboardView('tabela')" class="px-3 py-1.5 rounded-lg font-semibold transition ${DASHBOARD_VIEW === 'tabela' ? 'bg-pf-700 text-white shadow' : 'text-slate-400 hover:text-white'}">
                📋 Tabela Operacional
              </button>
              <button onclick="setDashboardView('kanban')" class="px-3 py-1.5 rounded-lg font-semibold transition ${DASHBOARD_VIEW === 'kanban' ? 'bg-pf-700 text-white shadow' : 'text-slate-400 hover:text-white'}">
                📌 Visão Kanban
              </button>
            </div>
          </div>

          <!-- Linha 1 de Filtros: Período, Cargo e Unidades da PB -->
          <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Ano</label>
              <select id="dash-filtro-ano" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="2026" ${DASHBOARD_FILTERS.ano === '2026' ? 'selected' : ''}>2026 (Integral)</option>
                <option value="2025" ${DASHBOARD_FILTERS.ano === '2025' ? 'selected' : ''}>2025</option>
                <option value="" ${!DASHBOARD_FILTERS.ano ? 'selected' : ''}>Todos os Anos</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Mês</label>
              <select id="dash-filtro-mes" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos os Meses</option>
                ${[...Array(12).keys()].map(i => {
                  const m = String(i + 1).padStart(2, '0');
                  const mesesNomes = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
                  return `<option value="${m}" ${DASHBOARD_FILTERS.mes === m ? 'selected' : ''}>${m} - ${mesesNomes[i]}</option>`;
                }).join('')}
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Bimestre</label>
              <select id="dash-filtro-bimestre" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos os Bimestres</option>
                <option value="1" ${DASHBOARD_FILTERS.bimestre === '1' ? 'selected' : ''}>1º Bim (Jan-Fev)</option>
                <option value="2" ${DASHBOARD_FILTERS.bimestre === '2' ? 'selected' : ''}>2º Bim (Mar-Abr)</option>
                <option value="3" ${DASHBOARD_FILTERS.bimestre === '3' ? 'selected' : ''}>3º Bim (Mai-Jun)</option>
                <option value="4" ${DASHBOARD_FILTERS.bimestre === '4' ? 'selected' : ''}>4º Bim (Jul-Ago)</option>
                <option value="5" ${DASHBOARD_FILTERS.bimestre === '5' ? 'selected' : ''}>5º Bim (Set-Out)</option>
                <option value="6" ${DASHBOARD_FILTERS.bimestre === '6' ? 'selected' : ''}>6º Bim (Nov-Dez)</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Trimestre</label>
              <select id="dash-filtro-trimestre" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos os Trimestres</option>
                <option value="1" ${DASHBOARD_FILTERS.trimestre === '1' ? 'selected' : ''}>1º Tri (Jan-Mar)</option>
                <option value="2" ${DASHBOARD_FILTERS.trimestre === '2' ? 'selected' : ''}>2º Tri (Abr-Jun)</option>
                <option value="3" ${DASHBOARD_FILTERS.trimestre === '3' ? 'selected' : ''}>3º Tri (Jul-Set)</option>
                <option value="4" ${DASHBOARD_FILTERS.trimestre === '4' ? 'selected' : ''}>4º Tri (Out-Dez)</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Semestre</label>
              <select id="dash-filtro-semestre" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos os Semestres</option>
                <option value="1" ${DASHBOARD_FILTERS.semestre === '1' ? 'selected' : ''}>1º Semestre (Jan-Jun)</option>
                <option value="2" ${DASHBOARD_FILTERS.semestre === '2' ? 'selected' : ''}>2º Semestre (Jul-Dez)</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Diárias por Cargo</label>
              <select id="dash-filtro-cargo" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos os Cargos</option>
                ${METADATA_CACHE.cargos.map(c => `<option value="${c.sigla}" ${DASHBOARD_FILTERS.cargo === c.sigla ? 'selected' : ''}>${c.sigla} - ${c.descricao}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Unidade da PB (SR / PAT / CGE)</label>
              <select id="dash-filtro-unidade-pb" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
                <option value="">Todas as Unidades da PB</option>
                <option value="SR/PF/PB" ${DASHBOARD_FILTERS.unidade_pb === 'SR/PF/PB' ? 'selected' : ''}>SR/PF/PB (Superintendência)</option>
                <option value="DPF/CGE/PB" ${DASHBOARD_FILTERS.unidade_pb === 'DPF/CGE/PB' ? 'selected' : ''}>DPF/CGE/PB (Campina Grande)</option>
                <option value="DPF/PAT/PB" ${DASHBOARD_FILTERS.unidade_pb === 'DPF/PAT/PB' ? 'selected' : ''}>DPF/PAT/PB (Patos)</option>
              </select>
            </div>
          </div>

          <!-- Linha 2 de Filtros: Setor SR/PB, Meio de Transporte, Status e Botão Limpar -->
          <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs pt-1 border-t border-slate-850">
            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Setor da SR/PB (DRPJ, DMA, NAD, NTI...)</label>
              <select id="dash-filtro-setor" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos os 52 Setores da SR/PB</option>
                ${METADATA_CACHE.setores.map(s => `<option value="${s.sigla}" ${DASHBOARD_FILTERS.setor === s.sigla ? 'selected' : ''}>${s.sigla} - ${s.nome}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Meio de Transporte</label>
              <select id="dash-filtro-transporte" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos os Meios</option>
                <option value="AEREO" ${DASHBOARD_FILTERS.meio_transporte === 'AEREO' ? 'selected' : ''}>✈️ Aéreo (Passagem Comercial)</option>
                <option value="TERRESTRE" ${DASHBOARD_FILTERS.meio_transporte === 'TERRESTRE' ? 'selected' : ''}>🚗 Terrestre / Viatura Oficial</option>
                <option value="PROPRIO" ${DASHBOARD_FILTERS.meio_transporte === 'PROPRIO' ? 'selected' : ''}>🚙 Veículo Próprio</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Status da Missão (Oficial)</label>
              <select id="dash-filtro-status" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-medium">
                <option value="">Todos os Status</option>
                <option value="Indicado" ${DASHBOARD_FILTERS.status === 'Indicado' ? 'selected' : ''}>Indicado</option>
                <option value="Pendente de Alocação" ${DASHBOARD_FILTERS.status === 'Pendente de Alocação' ? 'selected' : ''}>Pendente de Alocação</option>
                <option value="SAT pendente" ${DASHBOARD_FILTERS.status === 'SAT pendente' ? 'selected' : ''}>SAT pendente</option>
                <option value="SAT Atendida" ${DASHBOARD_FILTERS.status === 'SAT Atendida' ? 'selected' : ''}>SAT Atendida</option>
                <option value="SAT Recusada" ${DASHBOARD_FILTERS.status === 'SAT Recusada' ? 'selected' : ''}>SAT Recusada</option>
                <option value="SAT Reiterada" ${DASHBOARD_FILTERS.status === 'SAT Reiterada' ? 'selected' : ''}>SAT Reiterada</option>
                <option value="OM EMITIDA" ${DASHBOARD_FILTERS.status === 'OM EMITIDA' ? 'selected' : ''}>OM EMITIDA</option>
                <option value="PCDP CADASTRADA" ${DASHBOARD_FILTERS.status === 'PCDP CADASTRADA' ? 'selected' : ''}>PCDP CADASTRADA</option>
                <option value="PCDP ENCAMINHADA" ${DASHBOARD_FILTERS.status === 'PCDP ENCAMINHADA' ? 'selected' : ''}>PCDP ENCAMINHADA</option>
                <option value="PCDP PRESTAR CONTAS" ${DASHBOARD_FILTERS.status === 'PCDP PRESTAR CONTAS' ? 'selected' : ''}>PCDP PRESTAR CONTAS</option>
                <option value="Concluído" ${DASHBOARD_FILTERS.status === 'Concluído' ? 'selected' : ''}>Concluído</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Modalidade</label>
              <select id="dash-filtro-modalidade" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todas</option>
                <option value="INDIVIDUAL" ${DASHBOARD_FILTERS.modalidade === 'INDIVIDUAL' ? 'selected' : ''}>Individual (1 Servidor)</option>
                <option value="EQUIPE" ${DASHBOARD_FILTERS.modalidade === 'EQUIPE' ? 'selected' : ''}>Equipe Policial</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Tipo de Missão</label>
              <select id="dash-filtro-tipo" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos</option>
                ${METADATA_CACHE.tipos.map(t => `<option value="${t.nome}" ${DASHBOARD_FILTERS.tipo === t.nome ? 'selected' : ''}>${t.nome}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Destino Geral</label>
              <select id="dash-filtro-unidade" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todas as Unidades</option>
                ${METADATA_CACHE.unidades.map(u => `<option value="${u.sigla}" ${DASHBOARD_FILTERS.unidade === u.sigla ? 'selected' : ''}>${u.sigla}</option>`).join('')}
              </select>
            </div>

            <div class="flex items-end space-x-1">
              <button onclick="limparFiltrosDashboard()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 px-3 rounded-lg text-xs transition flex items-center justify-center space-x-1" title="Limpar todos os filtros">
                <span>✕ Limpar Filtros</span>
              </button>
            </div>
          </div>
        </div>

        ${alertsHtml}

        <!-- LINHA 1: KPI GRID - TOTALIZADORES FINANCEIROS E REGIONAIS DA PB -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <!-- Card 1: Missões e Efetivo -->
          <div class="bg-slate-950/60 border border-slate-800 p-5 rounded-2xl relative overflow-hidden shadow">
            <div class="absolute -right-2 -bottom-2 opacity-10 text-pf-gold">
              <svg class="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            </div>
            <p class="text-xs font-semibold uppercase text-slate-400">Total de Missões Filtradas</p>
            <p class="text-3xl font-extrabold text-white mt-1">${summary.total_missoes}</p>
            <div class="mt-2 text-xs space-y-0.5">
              <p class="text-emerald-400 font-bold">${summary.missoes_em_andamento} em andamento</p>
              <p class="text-blue-300 font-medium">${summary.total_servidores_em_missao} policiais designados (${summary.total_servidores_ativos} ativos)</p>
            </div>
          </div>

          <!-- Card 2: Total de Diárias SR/PF/PB, DPF/CGE/PB e DPF/PAT/PB -->
          <div class="bg-slate-950/60 border border-slate-800 p-5 rounded-2xl relative overflow-hidden shadow">
            <div class="absolute -right-2 -bottom-2 opacity-10 text-amber-400">
              <svg class="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <p class="text-xs font-semibold uppercase text-amber-400 font-bold">Total Diárias Paraíba (SR, PAT, CGE)</p>
            <p class="text-2xl font-black text-amber-300 mt-1">${formatMoney(summary.custo_total_diarias)}</p>
            <div class="mt-2 text-[11px] space-y-0.5 border-t border-slate-800 pt-1.5">
              <div class="flex justify-between text-slate-300">
                <span>SR/PF/PB (Sede):</span>
                <span class="font-bold text-amber-200">${formatMoney(summary.diarias_sr_pb || 0)}</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span>DPF/CGE/PB:</span>
                <span class="font-bold text-amber-200">${formatMoney(summary.diarias_cge_pb || 0)}</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span>DPF/PAT/PB:</span>
                <span class="font-bold text-amber-200">${formatMoney(summary.diarias_pat_pb || 0)}</span>
              </div>
            </div>
          </div>

          <!-- Card 3: Total Gasto com Passagens Aéreas PB (SR + CGE + PAT) -->
          <div class="bg-slate-950/60 border border-slate-800 p-5 rounded-2xl relative overflow-hidden shadow">
            <div class="absolute -right-2 -bottom-2 opacity-10 text-sky-400">
              <svg class="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
            </div>
            <p class="text-xs font-semibold uppercase text-sky-400 font-bold">Total Gasto com Passagens Aéreas</p>
            <p class="text-2xl font-black text-sky-300 mt-1">${formatMoney(summary.passagens_total_pb || summary.custo_total_passagens)}</p>
            <p class="text-[11px] text-slate-400 mt-2">
              Soma consolidada de bilhetes aéreos de todas as unidades da SR/PB, incluindo DPF/PAT/PB e DPF/CGE/PB.
            </p>
            <div class="mt-1 text-[10px] text-sky-400 font-semibold">
              Filtro ativo por setor da SR/PB: <span class="text-white">${DASHBOARD_FILTERS.setor || 'Todos os 52 setores'}</span>
            </div>
          </div>

          <!-- Card 4: Custo Geral Consolidado -->
          <div class="bg-slate-950/60 border border-slate-800 p-5 rounded-2xl relative overflow-hidden shadow">
            <div class="absolute -right-2 -bottom-2 opacity-10 text-emerald-400">
              <svg class="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
            </div>
            <p class="text-xs font-semibold uppercase text-emerald-400 font-bold">Custo Geral Consolidado</p>
            <p class="text-2xl font-black text-emerald-400 mt-1">${formatMoney(summary.custo_total_geral)}</p>
            <div class="mt-2 text-[11px] text-slate-400 space-y-0.5">
              <p>Diárias: <span class="font-bold text-white">${formatMoney(summary.custo_total_diarias)}</span></p>
              <p>Passagens Aéreas: <span class="font-bold text-white">${formatMoney(summary.custo_total_passagens)}</span></p>
            </div>
          </div>
        </div>

        <!-- LINHA 2: KPI GRID - QUANTIDADE DE SERVIDORES POR STATUS CRÍTICO (HOT FILTERS AO CLICAR) -->
        <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-1.5">
              <span>👥 Efetivo por Etapa Operacional (Clique no card para filtrar)</span>
            </h4>
            <span class="text-[10px] text-slate-400 uppercase font-semibold">Filtros Rápidos HOT</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <!-- 1. Cadastrar SCDP -->
            <div onclick="filtrarPorStatusRapido('OM EMITIDA')"
                 class="cursor-pointer bg-slate-900 hover:bg-slate-850 p-4 rounded-xl border border-blue-900/60 hover:border-blue-500 transition shadow">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase text-blue-400">Cadastrar SCDP</span>
                <span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
              </div>
              <p class="text-2xl font-black text-white mt-1">${summary.servidores_status_scdp || 0} <span class="text-xs font-normal text-slate-400">servidores</span></p>
              <p class="text-[10px] text-slate-400 mt-1">OM Emitida • Pendente SCDP/PCDP</p>
            </div>

            <!-- 2. Prestação Contas Pendente -->
            <div onclick="filtrarPorStatusRapido('PCDP PRESTAR CONTAS')"
                 class="cursor-pointer bg-slate-900 hover:bg-slate-850 p-4 rounded-xl border border-orange-900/60 hover:border-orange-500 transition shadow">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase text-orange-400">Prestação Contas Pendente</span>
                <span class="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
              </div>
              <p class="text-2xl font-black text-white mt-1">${summary.servidores_status_prestacao_contas || 0} <span class="text-xs font-normal text-slate-400">servidores</span></p>
              <p class="text-[10px] text-slate-400 mt-1">Retorno de Missão • Prestar Contas</p>
            </div>

            <!-- 3. OM Pendente -->
            <div onclick="filtrarPorStatusRapido('SAT Atendida')"
                 class="cursor-pointer bg-slate-900 hover:bg-slate-850 p-4 rounded-xl border border-amber-900/60 hover:border-amber-500 transition shadow">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase text-amber-400">OM Pendente</span>
                <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              </div>
              <p class="text-2xl font-black text-white mt-1">${summary.servidores_status_om_pendente || 0} <span class="text-xs font-normal text-slate-400">servidores</span></p>
              <p class="text-[10px] text-slate-400 mt-1">SAT Atendida • Aguardando Emissão OM</p>
            </div>

            <!-- 4. Missão Concluída -->
            <div onclick="filtrarPorStatusRapido('Concluído')"
                 class="cursor-pointer bg-slate-900 hover:bg-slate-850 p-4 rounded-xl border border-emerald-900/60 hover:border-emerald-500 transition shadow">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase text-emerald-400">Missão Concluída</span>
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              </div>
              <p class="text-2xl font-black text-white mt-1">${summary.servidores_status_concluida || 0} <span class="text-xs font-normal text-slate-400">servidores</span></p>
              <p class="text-[10px] text-slate-400 mt-1">Ciclo Finalizado com Sucesso</p>
            </div>
          </div>
        </div>

        <!-- CONTEÚDO DA VISÃO SELECIONADA -->
        <div id="dashboard-view-body">
          ${DASHBOARD_VIEW === 'graficos' ? renderDashboardGraficosHtml() : ''}
          ${DASHBOARD_VIEW === 'tabela' ? renderDashboardTabelaHtml(missoes) : ''}
          ${DASHBOARD_VIEW === 'kanban' ? renderDashboardKanbanHtml(missoes) : ''}
        </div>

      </div>
    `;

    if (DASHBOARD_VIEW === 'graficos') {
      await initializeDashboardCharts(qs);
    }

  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao carregar dashboard: ${err.message}</div>`;
  }
}

function filtrarPorStatusRapido(statusNome) {
  DASHBOARD_FILTERS.status = statusNome;
  renderDashboard(document.getElementById("view-container"));
}

function setDashboardView(viewMode) {
  DASHBOARD_VIEW = viewMode;
  renderDashboard(document.getElementById("view-container"));
}

function aplicarFiltrosDashboard() {
  DASHBOARD_FILTERS.ano = document.getElementById("dash-filtro-ano")?.value || "";
  DASHBOARD_FILTERS.mes = document.getElementById("dash-filtro-mes")?.value || "";
  DASHBOARD_FILTERS.bimestre = document.getElementById("dash-filtro-bimestre")?.value || "";
  DASHBOARD_FILTERS.trimestre = document.getElementById("dash-filtro-trimestre")?.value || "";
  DASHBOARD_FILTERS.semestre = document.getElementById("dash-filtro-semestre")?.value || "";
  DASHBOARD_FILTERS.cargo = document.getElementById("dash-filtro-cargo")?.value || "";
  DASHBOARD_FILTERS.unidade_pb = document.getElementById("dash-filtro-unidade-pb")?.value || "";
  DASHBOARD_FILTERS.setor = document.getElementById("dash-filtro-setor")?.value || "";
  DASHBOARD_FILTERS.meio_transporte = document.getElementById("dash-filtro-transporte")?.value || "";
  DASHBOARD_FILTERS.status = document.getElementById("dash-filtro-status")?.value || "";
  DASHBOARD_FILTERS.modalidade = document.getElementById("dash-filtro-modalidade")?.value || "";
  DASHBOARD_FILTERS.tipo = document.getElementById("dash-filtro-tipo")?.value || "";
  DASHBOARD_FILTERS.unidade = document.getElementById("dash-filtro-unidade")?.value || "";
  renderDashboard(document.getElementById("view-container"));
}

function limparFiltrosDashboard() {
  DASHBOARD_FILTERS = {
    ano: "2026",
    mes: "",
    bimestre: "",
    trimestre: "",
    semestre: "",
    status: "",
    modalidade: "",
    tipo: "",
    unidade: "",
    cargo: "",
    setor: "",
    meio_transporte: "",
    unidade_pb: "",
    data_de: "",
    data_ate: ""
  };
  renderDashboard(document.getElementById("view-container"));
}

// Sub-renderers do Dashboard
function renderDashboardGraficosHtml() {
  return `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <!-- Gráfico 1: Evolução Financeira de Diárias e Passagens -->
      <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5">
        <h4 class="text-xs font-bold text-white uppercase tracking-wider mb-1">Evolução Financeira: Diárias e Passagens</h4>
        <p class="text-[11px] text-slate-400 mb-4">Execução orçamentária por mês / período com base nos filtros selecionados</p>
        <div class="relative h-64">
          <canvas id="chart-mensal"></canvas>
        </div>
      </div>

      <!-- Gráfico 2: Diárias por Cargo da Polícia Federal -->
      <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5">
        <h4 class="text-xs font-bold text-white uppercase tracking-wider mb-1">Diárias por Cargo (DPF, APF, EPF, PPF, PCF)</h4>
        <p class="text-[11px] text-slate-400 mb-4">Total financeiro de diárias distribuído por carreira policial</p>
        <div class="relative h-64">
          <canvas id="chart-cargo"></canvas>
        </div>
      </div>

      <!-- Gráfico 3: Gasto de Passagens por Unidade da SR/PF/PB -->
      <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5">
        <h4 class="text-xs font-bold text-white uppercase tracking-wider mb-1">Gasto de Passagens Aéreas por Unidade PB</h4>
        <p class="text-[11px] text-slate-400 mb-4">Comparativo financeiro entre SR/PF/PB, DPF/CGE/PB e DPF/PAT/PB</p>
        <div class="relative h-64">
          <canvas id="chart-passagens-unidade"></canvas>
        </div>
      </div>

      <!-- Gráfico 4: Gasto de Passagens por Setor da SR/PB -->
      <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5">
        <h4 class="text-xs font-bold text-white uppercase tracking-wider mb-1">Gasto de Passagens por Setor da SR/PB</h4>
        <p class="text-[11px] text-slate-400 mb-4">Principais setores demandantes de passagens aéreas (DRPJ, DMA, NAD, NTI, DREX, SIP, SELOG...)</p>
        <div class="relative h-64">
          <canvas id="chart-passagens-setor"></canvas>
        </div>
      </div>

      <!-- Gráfico 5: Distribuição por Status Oficial -->
      <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 lg:col-span-2">
        <h4 class="text-xs font-bold text-white uppercase tracking-wider mb-1">Missões por Status do Ciclo Operacional</h4>
        <p class="text-[11px] text-slate-400 mb-4">Distribuição do volume de processos pelos status oficiais do sistema</p>
        <div class="relative h-64 flex items-center justify-center">
          <canvas id="chart-status"></canvas>
        </div>
      </div>
    </div>
  `;
}

async function initializeDashboardCharts(qs) {
  try {
    const chartsData = await apiFetch(`/api/dashboard/charts${qs}`);
    destroyCharts();

    // 1. Chart Mensal (Linha / Barra)
    const ctxMensal = document.getElementById("chart-mensal")?.getContext("2d");
    if (ctxMensal && chartsData.custos_por_mes) {
      const labels = chartsData.custos_por_mes.map(c => {
        const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        const mesAno = c.mes_ano || c.mes || "";
        if (mesAno.includes("-")) {
          const parts = mesAno.split("-");
          const mIdx = parseInt(parts[1], 10) - 1;
          const yr = parts[0].length >= 4 ? parts[0].slice(2) : parts[0];
          return `${meses[mIdx] || parts[1]}/${yr}`;
        }
        const mIdx = parseInt(mesAno, 10) - 1;
        return meses[mIdx] || mesAno;
      });
      const dataDiarias = chartsData.custos_por_mes.map(c => c.total_diarias);
      const dataPassagens = chartsData.custos_por_mes.map(c => c.total_passagens || 0);

      CHART_INSTANCES.mensal = new Chart(ctxMensal, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Diárias (R$)",
              data: dataDiarias,
              backgroundColor: "rgba(212, 175, 55, 0.75)",
              borderColor: "#C69214",
              borderWidth: 1
            },
            {
              label: "Passagens Aéreas (R$)",
              data: dataPassagens,
              backgroundColor: "rgba(56, 189, 248, 0.65)",
              borderColor: "#0284c7",
              borderWidth: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "#94a3b8", font: { size: 10 } } }
          },
          scales: {
            x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } },
            y: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } }
          }
        }
      });
    }

    // 2. Chart Diárias por Cargo
    const ctxCargo = document.getElementById("chart-cargo")?.getContext("2d");
    if (ctxCargo && chartsData.diarias_por_cargo) {
      const labels = chartsData.diarias_por_cargo.map(c => c.cargo);
      const data = chartsData.diarias_por_cargo.map(c => c.total_diarias);

      CHART_INSTANCES.cargo = new Chart(ctxCargo, {
        type: "bar",
        data: {
          labels,
          datasets: [{
            label: "Total Diárias (R$)",
            data,
            backgroundColor: "rgba(234, 179, 8, 0.7)",
            borderColor: "#ca8a04",
            borderWidth: 1
          }]
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } },
            y: { ticks: { color: "#cbd5e1", font: { size: 10 } }, grid: { display: false } }
          }
        }
      });
    }

    // 3. Chart Passagens por Unidade da SR/PF/PB
    const ctxPassagensUnid = document.getElementById("chart-passagens-unidade")?.getContext("2d");
    if (ctxPassagensUnid && chartsData.passagens_por_unidade) {
      const labels = chartsData.passagens_por_unidade.map(u => u.unidade);
      const data = chartsData.passagens_por_unidade.map(u => u.total_passagens);

      CHART_INSTANCES.passagensUnidade = new Chart(ctxPassagensUnid, {
        type: "bar",
        data: {
          labels,
          datasets: [{
            label: "Gasto com Passagens (R$)",
            data,
            backgroundColor: "rgba(14, 165, 233, 0.7)",
            borderColor: "#0284c7",
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { ticks: { color: "#cbd5e1", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } },
            y: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } }
          }
        }
      });
    }

    // 4. Chart Passagens por Setor da SR/PB
    const ctxPassagensSetor = document.getElementById("chart-passagens-setor")?.getContext("2d");
    if (ctxPassagensSetor && chartsData.passagens_por_setor) {
      const labels = chartsData.passagens_por_setor.map(s => s.setor);
      const data = chartsData.passagens_por_setor.map(s => s.total_passagens);

      CHART_INSTANCES.passagensSetor = new Chart(ctxPassagensSetor, {
        type: "bar",
        data: {
          labels,
          datasets: [{
            label: "Gasto Passagens (R$)",
            data,
            backgroundColor: "rgba(168, 85, 247, 0.7)",
            borderColor: "#a855f7",
            borderWidth: 1
          }]
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.05)" } },
            y: { ticks: { color: "#cbd5e1", font: { size: 9 } }, grid: { display: false } }
          }
        }
      });
    }

    // 5. Chart Status Oficial
    const ctxStatus = document.getElementById("chart-status")?.getContext("2d");
    if (ctxStatus && chartsData.status_counts) {
      const labels = chartsData.status_counts.map(s => s.status);
      const counts = chartsData.status_counts.map(s => s.total);
      const colors = [
        "#64748b", "#3b4252", "#d97706", "#eab308", "#16a34a", "#dc2626", "#ea580c", "#2563eb", "#6366f1", "#9333ea", "#15803d"
      ];

      CHART_INSTANCES.status = new Chart(ctxStatus, {
        type: "doughnut",
        data: {
          labels,
          datasets: [{
            data: counts,
            backgroundColor: colors.slice(0, counts.length),
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "right", labels: { color: "#cbd5e1", font: { size: 10 } } }
          }
        }
      });
    }
  } catch (err) {
    console.error("Erro ao renderizar gráficos Chart.js:", err);
  }
}

function renderDashboardTabelaHtml(missoes) {
  return `
    <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 shadow-lg">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h4 class="text-sm font-bold text-white">Relação Operacional de Missões Filtradas (${missoes.length})</h4>
          <p class="text-xs text-slate-400">Detalhamento administrativo, financeiro e efetivo designado</p>
        </div>
        <button onclick="navigate('missoes')" class="text-xs font-semibold text-pf-gold hover:underline">
          Abrir Módulo de Missões &rarr;
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[10px]">
            <tr>
              <th class="py-2.5 px-3">Código</th>
              <th class="py-2.5 px-3">Modalidade</th>
              <th class="py-2.5 px-3">Título da Missão</th>
              <th class="py-2.5 px-3">Período</th>
              <th class="py-2.5 px-3">Status</th>
              <th class="py-2.5 px-3">Diária Base</th>
              <th class="py-2.5 px-3">Efetivo</th>
              <th class="py-2.5 px-3">Custo Total</th>
              <th class="py-2.5 px-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60">
            ${missoes.map(m => `
              <tr class="hover:bg-slate-800/40 transition">
                <td class="py-3 px-3 font-mono font-bold text-pf-gold">${m.codigo_missao}</td>
                <td class="py-3 px-3">
                  <span class="badge-status badge-${m.modalidade || 'EQUIPE'}">${m.modalidade || 'EQUIPE'}</span>
                </td>
                <td class="py-3 px-3 font-medium text-white max-w-xs truncate">
                  ${m.titulo}
                  <div class="text-[10px] text-slate-400 truncate">${m.unidade_solicitante} &rarr; ${m.unidade_destino || m.localidade_descricao}</div>
                </td>
                <td class="py-3 px-3 text-slate-400 whitespace-nowrap">${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)} (${m.total_dias}d)</td>
                <td class="py-3 px-3">
                  <span class="badge-status ${getStatusBadgeClass(m.status_atual)} text-[10px]">${m.status_atual}</span>
                </td>
                <td class="py-3 px-3 font-semibold text-amber-300">${formatMoney(m.valor_diaria_padrao)}</td>
                <td class="py-3 px-3 text-slate-300">${m.total_participantes} policiais</td>
                <td class="py-3 px-3 font-bold text-emerald-400">${formatMoney(m.total_custo_geral)}</td>
                <td class="py-3 px-3 text-right">
                  <button onclick="openMissaoDetail('${m.codigo_missao}')" class="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold transition">
                    Detalhes
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDashboardKanbanHtml(missoes) {
  const colunas = [
    {
      titulo: "1. Indicação / Planejamento",
      statusList: ["RASCUNHO", "SOLICITADA", "Indicado", "Pendente de Alocação"],
      badgeColor: "bg-slate-800 text-slate-300"
    },
    {
      titulo: "2. Solicitação SAT",
      statusList: ["SAT pendente", "SAT Reiterada", "SAT Atendida", "APROVADA"],
      badgeColor: "bg-blue-900/60 text-blue-200"
    },
    {
      titulo: "3. OM & PCDP",
      statusList: ["OM EMITIDA", "OM_EMITIDA", "PCDP CADASTRADA", "PCDP ENCAMINHADA", "PCDP_TRAMITADA", "EM_ANDAMENTO"],
      badgeColor: "bg-purple-900/60 text-purple-200"
    },
    {
      titulo: "4. Prestação Contas & Conclusão",
      statusList: ["PCDP PRESTAR CONTAS", "PRESTACAO_CONTAS", "Concluído", "CONCLUIDA"],
      badgeColor: "bg-emerald-900/60 text-emerald-200"
    },
    {
      titulo: "5. Canceladas / Recusadas",
      statusList: ["CANCELADA", "SAT Recusada"],
      badgeColor: "bg-red-900/60 text-red-200"
    }
  ];

  return `
    <div class="overflow-x-auto pb-4">
      <div class="flex space-x-4 min-w-[1200px]">
        ${colunas.map(col => {
          const missCol = missoes.filter(m => col.statusList.includes(m.status_atual));
          return `
            <div class="kanban-col flex-1 bg-slate-950/60 border border-slate-800 rounded-2xl p-3 flex flex-col max-h-[700px]">
              <div class="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                <span class="text-xs font-bold text-white uppercase">${col.titulo}</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${col.badgeColor}">${missCol.length}</span>
              </div>

              <div class="flex-1 overflow-y-auto space-y-2.5 pr-1">
                ${missCol.length === 0 ? `
                  <p class="text-[11px] text-slate-500 text-center py-8">Nenhuma missão nesta fase.</p>
                ` : missCol.map(m => `
                  <div class="kanban-card bg-slate-900 border border-slate-800 rounded-xl p-3 shadow-md space-y-2">
                    <div class="flex items-center justify-between">
                      <span class="font-mono text-xs font-bold text-pf-gold">${m.codigo_missao}</span>
                      <span class="badge-status badge-${m.modalidade || 'EQUIPE'} text-[9px]">${m.modalidade || 'EQUIPE'}</span>
                    </div>

                    <h5 class="text-xs font-bold text-white line-clamp-2">${m.titulo}</h5>
                    <p class="text-[10px] text-slate-400">${m.unidade_solicitante} &rarr; ${m.unidade_destino || m.localidade_descricao}</p>
                    
                    <div class="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800">
                      <span>${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)}</span>
                      <span class="font-semibold text-white">${m.total_participantes} pol.</span>
                    </div>

                    <div class="flex items-center justify-between pt-1">
                      <span class="text-xs font-extrabold text-emerald-400">${formatMoney(m.total_custo_geral)}</span>
                      <button onclick="openMissaoDetail('${m.codigo_missao}')" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[10px] font-semibold transition">
                        Gerenciar
                      </button>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// ==============================================================================
// 2. GESTÃO DE MISSÕES (COM FILTROS COMPLETOS, MODALIDADE E MISSIONÁRIO)
// ==============================================================================
async function renderMissoes(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando missões...</div>`;
  try {
    const missoes = await apiFetch("/api/missoes");

    const podeCriar = CURRENT_USER && (CURRENT_USER.role === "ADMIN" || CURRENT_USER.role === "CADASTRADOR");

    container.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <!-- Action / Filter Bar -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-bold text-white uppercase tracking-wider">Gestão Corporativa de Missões</h3>
              <p class="text-xs text-slate-400">Missões em Equipe e Individuais • DPF/PB</p>
            </div>
            ${podeCriar ? `
              <button onclick="openModalNovaMissao()" class="bg-gradient-to-r from-pf-gold to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow-lg flex items-center space-x-2 transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                <span>Nova Missão</span>
              </button>
            ` : `
              <span class="px-3 py-1 bg-slate-800 text-slate-400 text-xs rounded-xl font-semibold border border-slate-700">
                🔒 Perfil ${CURRENT_USER?.role || 'GERENCIAL'} (Somente Leitura)
              </span>
            `}
          </div>

          <!-- Filtros Rápidos -->
          <div class="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-2 text-xs pt-2 border-t border-slate-800/80">
            <div class="md:col-span-2">
              <input type="text" id="filtro-busca" placeholder="Buscar por código, título, cidade, OM, policial..."
                     class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pf-gold">
            </div>

            <div>
              <select id="filtro-status" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none">
                <option value="">Todos os Status</option>
                <option value="RASCUNHO">Rascunho</option>
                <option value="SOLICITADA">Solicitada</option>
                <option value="APROVADA">Aprovada</option>
                <option value="OM_EMITIDA">OM Emitida</option>
                <option value="PCDP_TRAMITADA">PCDP Tramitada</option>
                <option value="EM_ANDAMENTO">Em Andamento</option>
                <option value="PRESTACAO_CONTAS">Prestação Contas</option>
                <option value="CONCLUIDA">Concluída</option>
                <option value="CANCELADA">Cancelada</option>
              </select>
            </div>

            <div>
              <select id="filtro-modalidade" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none">
                <option value="">Todas as Modalidades</option>
                <option value="EQUIPE">Equipe Policial</option>
                <option value="INDIVIDUAL">Missão Individual</option>
              </select>
            </div>

            <div>
              <select id="filtro-ano" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none">
                <option value="">Todos os Anos</option>
                <option value="2026">Ano 2026</option>
                <option value="2025">Ano 2025</option>
              </select>
            </div>

            <div>
              <select id="filtro-mes" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none">
                <option value="">Todos os Meses</option>
                ${[...Array(12).keys()].map(i => {
                  const m = String(i + 1).padStart(2, '0');
                  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
                  return `<option value="${m}">${m} - ${meses[i]}</option>`;
                }).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs" id="tabela-missoes">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[10px]">
                <tr>
                  <th class="py-3 px-3">Código</th>
                  <th class="py-3 px-3">Modalidade</th>
                  <th class="py-3 px-3">Título / Descrição</th>
                  <th class="py-3 px-3">Origem / Destino</th>
                  <th class="py-3 px-3">Período</th>
                  <th class="py-3 px-3">Status</th>
                  <th class="py-3 px-3">Diária Base</th>
                  <th class="py-3 px-3">Efetivo</th>
                  <th class="py-3 px-3">Custo Total</th>
                  <th class="py-3 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60" id="missoes-tbody">
                ${renderMissoesRows(missoes)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Listeners dos filtros
    const onFilterChange = () => applyMissoesFilter(missoes);
    document.getElementById("filtro-busca").addEventListener("input", onFilterChange);
    document.getElementById("filtro-status").addEventListener("change", onFilterChange);
    document.getElementById("filtro-modalidade").addEventListener("change", onFilterChange);
    document.getElementById("filtro-ano").addEventListener("change", onFilterChange);
    document.getElementById("filtro-mes").addEventListener("change", onFilterChange);

  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao listar missões: ${err.message}</div>`;
  }
}

function renderMissoesRows(list) {
  if (list.length === 0) {
    return `<tr><td colspan="10" class="text-center py-8 text-slate-500">Nenhuma missão encontrada com os filtros aplicados.</td></tr>`;
  }
  return list.map(m => `
    <tr class="hover:bg-slate-800/40 transition">
      <td class="py-3 px-3 font-mono font-bold text-pf-gold">${m.codigo_missao}</td>
      <td class="py-3 px-3">
        <span class="badge-status badge-${m.modalidade || 'EQUIPE'} text-[10px]">${m.modalidade || 'EQUIPE'}</span>
      </td>
      <td class="py-3 px-3">
        <p class="font-semibold text-white max-w-xs truncate">${m.titulo}</p>
        ${m.modalidade === 'INDIVIDUAL' && m.missionario_nome ? `
          <p class="text-[10px] text-fuchsia-400 font-medium">Missionário: ${m.missionario_nome}</p>
        ` : (m.responsavel_nome ? `
          <p class="text-[10px] text-slate-400">Chefe: ${m.responsavel_nome}</p>
        ` : '')}
      </td>
      <td class="py-3 px-3 text-slate-300">
        <span class="font-medium text-slate-200">${m.unidade_solicitante}</span> &rarr; <span>${m.unidade_destino || m.localidade_descricao}</span>
      </td>
      <td class="py-3 px-3 text-slate-400 whitespace-nowrap">${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)} (${m.total_dias}d)</td>
      <td class="py-3 px-3">
        <span class="badge-status ${getStatusBadgeClass(m.status_atual)} text-[10px]">${m.status_atual}</span>
      </td>
      <td class="py-3 px-3 font-bold text-amber-300">
        <span class="bg-amber-950/40 border border-amber-800/60 px-2 py-0.5 rounded text-[11px]">
          ${formatMoney(m.valor_diaria_padrao)}
        </span>
      </td>
      <td class="py-3 px-3 text-slate-300">${m.total_participantes} servidores</td>
      <td class="py-3 px-3 font-bold text-emerald-400">${formatMoney(m.total_custo_geral)}</td>
      <td class="py-3 px-3 text-right">
        <button onclick="openMissaoDetail('${m.codigo_missao}')" class="px-2.5 py-1 bg-pf-700 hover:bg-pf-600 text-white rounded text-[11px] font-semibold transition">
          Gerenciar
        </button>
      </td>
    </tr>
  `).join('');
}

function applyMissoesFilter(allMissions) {
  const busca = document.getElementById("filtro-busca").value.toLowerCase();
  const status = document.getElementById("filtro-status").value;
  const modalidade = document.getElementById("filtro-modalidade").value;
  const ano = document.getElementById("filtro-ano").value;
  const mes = document.getElementById("filtro-mes").value;

  const filtered = allMissions.filter(m => {
    const matchBusca = !busca || 
      m.codigo_missao.toLowerCase().includes(busca) ||
      m.titulo.toLowerCase().includes(busca) ||
      m.localidade_descricao.toLowerCase().includes(busca) ||
      (m.numero_om && m.numero_om.toLowerCase().includes(busca)) ||
      (m.missionario_nome && m.missionario_nome.toLowerCase().includes(busca)) ||
      (m.responsavel_nome && m.responsavel_nome.toLowerCase().includes(busca));
    
    const matchStatus = !status || m.status_atual === status;
    const matchModalidade = !modalidade || (m.modalidade || 'EQUIPE') === modalidade;
    const matchAno = !ano || (m.data_inicio && m.data_inicio.startsWith(ano));
    const matchMes = !mes || (m.data_inicio && m.data_inicio.slice(5, 7) === mes);

    return matchBusca && matchStatus && matchModalidade && matchAno && matchMes;
  });

  document.getElementById("missoes-tbody").innerHTML = renderMissoesRows(filtered);
}

// ==============================================================================
// 2.5. ABA CUSTOS POR MISSÃO E POR MISSIONÁRIO (CONSOLIDADO DE DIÁRIAS E PASSAGENS)
// ==============================================================================
let CUSTOS_FILTERS = {
  ano: "2026",
  mes: "",
  setor: "",
  meio_transporte: "",
  unidade_pb: "",
  cargo: "",
  busca: ""
};

async function renderCustos(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando demonstrativo consolidado de custos...</div>`;

  try {
    const qParams = new URLSearchParams();
    if (CUSTOS_FILTERS.ano) qParams.append("ano", CUSTOS_FILTERS.ano);
    if (CUSTOS_FILTERS.mes) qParams.append("mes", CUSTOS_FILTERS.mes);
    if (CUSTOS_FILTERS.setor) qParams.append("setor", CUSTOS_FILTERS.setor);
    if (CUSTOS_FILTERS.meio_transporte) qParams.append("meio_transporte", CUSTOS_FILTERS.meio_transporte);
    if (CUSTOS_FILTERS.unidade_pb) qParams.append("unidade_pb", CUSTOS_FILTERS.unidade_pb);

    const qs = qParams.toString() ? `?${qParams.toString()}` : "";
    const [missoes, summary] = await Promise.all([
      apiFetch(`/api/missoes${qs}`),
      apiFetch(`/api/dashboard/summary${qs}`)
    ]);

    // Montar linhas por servidor / missionário participante
    let items = [];
    missoes.forEach(m => {
      if (m.participantes && m.participantes.length > 0) {
        m.participantes.forEach(p => {
          items.push({
            missao_id: m.id,
            codigo_missao: m.codigo_missao,
            titulo_missao: m.titulo,
            unidade_solicitante: m.unidade_solicitante,
            unidade_destino: m.unidade_destino || m.localidade_descricao,
            setor_destino: m.setor_destino || "-",
            modalidade: m.modalidade || "EQUIPE",
            status_atual: m.status_atual,
            meio_transporte: p.meio_transporte || m.meio_transporte || "TERRESTRE",
            servidor_matricula: p.servidor_matricula,
            servidor_nome: p.servidor_nome || m.missionario_nome || "-",
            cargo_sigla: p.cargo_sigla || "-",
            data_apresentacao: p.data_apresentacao || m.data_inicio,
            data_retorno: p.data_retorno || m.data_termino,
            qtd_diarias: p.qtd_diarias || m.total_dias || 0,
            valor_diaria_unitaria: p.valor_diaria_unitaria || m.valor_diaria_padrao || 425,
            total_diarias: p.total_diarias || 0,
            valor_passagem_aerea: p.valor_passagem_aerea || (m.meio_transporte === 'AEREO' ? (m.custo_estimado_passagens || 0) : 0),
            total_custo_individual: p.total_custo_individual || (p.total_diarias + (p.valor_passagem_aerea || 0))
          });
        });
      } else if (m.modalidade === "INDIVIDUAL" && m.missionario_nome) {
        items.push({
          missao_id: m.id,
          codigo_missao: m.codigo_missao,
          titulo_missao: m.titulo,
          unidade_solicitante: m.unidade_solicitante,
          unidade_destino: m.unidade_destino || m.localidade_descricao,
          setor_destino: m.setor_destino || "-",
          modalidade: "INDIVIDUAL",
          status_atual: m.status_atual,
          meio_transporte: m.meio_transporte || "AEREO",
          servidor_matricula: m.missionario_matricula || "-",
          servidor_nome: m.missionario_nome,
          cargo_sigla: "-",
          data_apresentacao: m.data_inicio,
          data_retorno: m.data_termino,
          qtd_diarias: m.total_dias || 0,
          valor_diaria_unitaria: m.valor_diaria_padrao || 425,
          total_diarias: m.total_custo_diarias || ((m.total_dias || 0) * (m.valor_diaria_padrao || 425)),
          valor_passagem_aerea: m.custo_estimado_passagens || m.total_custo_passagens || 0,
          total_custo_individual: m.total_custo_geral || 0
        });
      }
    });

    // Filtros locais (busca, cargo)
    if (CUSTOS_FILTERS.busca) {
      const b = CUSTOS_FILTERS.busca.toLowerCase();
      items = items.filter(it =>
        it.codigo_missao.toLowerCase().includes(b) ||
        it.titulo_missao.toLowerCase().includes(b) ||
        it.servidor_nome.toLowerCase().includes(b) ||
        it.servidor_matricula.toLowerCase().includes(b) ||
        it.setor_destino.toLowerCase().includes(b)
      );
    }
    if (CUSTOS_FILTERS.cargo) {
      items = items.filter(it => it.cargo_sigla === CUSTOS_FILTERS.cargo);
    }

    const somaDiarias = items.reduce((acc, it) => acc + (it.total_diarias || 0), 0);
    const somaPassagens = items.reduce((acc, it) => acc + (it.valor_passagem_aerea || 0), 0);
    const somaTotal = somaDiarias + somaPassagens;

    container.innerHTML = `
      <div class="space-y-6 animate-fade-in">
        <!-- HEADER E FILTROS HOT -->
        <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div class="flex items-center space-x-2">
                <h3 class="text-base font-bold text-white uppercase tracking-wider">Demonstrativo de Custos por Missão & Missionário</h3>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 border border-amber-800 text-pf-gold">Visão Individualizada</span>
              </div>
              <p class="text-xs text-slate-400 mt-1">Detalhamento individual de diárias e passagens aéreas por servidor com filtros por setor, transporte e período</p>
            </div>
            <div class="flex items-center space-x-2">
              <button onclick="navigate('dashboard')" class="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 transition">
                &larr; Painel Geral
              </button>
              <button onclick="navigate('missoes')" class="px-3 py-1.5 rounded-lg bg-pf-700 hover:bg-pf-600 text-xs font-semibold text-white transition">
                Gestão de Missões
              </button>
            </div>
          </div>

          <!-- Filtros HOT de Custos -->
          <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-2 text-xs pt-2 border-t border-slate-850">
            <div class="lg:col-span-2">
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Buscar por Policial, Matrícula, Código ou Setor</label>
              <input type="text" id="custos-busca" value="${CUSTOS_FILTERS.busca}" oninput="aplicarFiltrosCustos()" placeholder="Ex: João, 25489, DRPJ, MIS-2026..."
                     class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Setor SR/PB (52 Setores)</label>
              <select id="custos-setor" onchange="aplicarFiltrosCustos()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos os 52 Setores</option>
                ${METADATA_CACHE.setores.map(s => `<option value="${s.sigla}" ${CUSTOS_FILTERS.setor === s.sigla ? 'selected' : ''}>${s.sigla} - ${s.nome}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Meio de Transporte</label>
              <select id="custos-transporte" onchange="aplicarFiltrosCustos()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos os Meios</option>
                <option value="AEREO" ${CUSTOS_FILTERS.meio_transporte === 'AEREO' ? 'selected' : ''}>✈️ Aéreo (Passagem)</option>
                <option value="TERRESTRE" ${CUSTOS_FILTERS.meio_transporte === 'TERRESTRE' ? 'selected' : ''}>🚗 Terrestre / Viatura</option>
                <option value="PROPRIO" ${CUSTOS_FILTERS.meio_transporte === 'PROPRIO' ? 'selected' : ''}>🚙 Veículo Próprio</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Unidade da PB</label>
              <select id="custos-unidade-pb" onchange="aplicarFiltrosCustos()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
                <option value="">Todas da PB</option>
                <option value="SR/PF/PB" ${CUSTOS_FILTERS.unidade_pb === 'SR/PF/PB' ? 'selected' : ''}>SR/PF/PB</option>
                <option value="DPF/CGE/PB" ${CUSTOS_FILTERS.unidade_pb === 'DPF/CGE/PB' ? 'selected' : ''}>DPF/CGE/PB</option>
                <option value="DPF/PAT/PB" ${CUSTOS_FILTERS.unidade_pb === 'DPF/PAT/PB' ? 'selected' : ''}>DPF/PAT/PB</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Ano / Mês</label>
              <div class="flex space-x-1">
                <select id="custos-ano" onchange="aplicarFiltrosCustos()" class="w-1/2 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  <option value="2026" ${CUSTOS_FILTERS.ano === '2026' ? 'selected' : ''}>2026</option>
                  <option value="2025" ${CUSTOS_FILTERS.ano === '2025' ? 'selected' : ''}>2025</option>
                  <option value="" ${!CUSTOS_FILTERS.ano ? 'selected' : ''}>Todos</option>
                </select>
                <select id="custos-mes" onchange="aplicarFiltrosCustos()" class="w-1/2 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  <option value="">Mês</option>
                  ${[...Array(12).keys()].map(i => {
                    const m = String(i + 1).padStart(2, '0');
                    return `<option value="${m}" ${CUSTOS_FILTERS.mes === m ? 'selected' : ''}>${m}</option>`;
                  }).join('')}
                </select>
              </div>
            </div>

            <div class="flex items-end">
              <button onclick="limparFiltrosCustos()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2 px-3 rounded-lg text-xs transition">
                ✕ Limpar
              </button>
            </div>
          </div>
        </div>

        <!-- KPI CARDS CONSOLIDADOS DE CUSTOS -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div class="bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
            <p class="text-[11px] font-semibold uppercase text-slate-400">Total de Missionários Listados</p>
            <p class="text-2xl font-black text-white mt-1">${items.length} <span class="text-xs font-normal text-slate-400">designações</span></p>
            <p class="text-[10px] text-slate-500 mt-1">Conforme filtros ativos</p>
          </div>
          <div class="bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
            <p class="text-[11px] font-semibold uppercase text-amber-400 font-bold">Subtotal de Diárias (R$)</p>
            <p class="text-2xl font-black text-amber-300 mt-1">${formatMoney(somaDiarias)}</p>
            <p class="text-[10px] text-slate-400 mt-1">Total liquidado em diárias</p>
          </div>
          <div class="bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
            <p class="text-[11px] font-semibold uppercase text-sky-400 font-bold">Subtotal de Passagens Aéreas (R$)</p>
            <p class="text-2xl font-black text-sky-300 mt-1">${formatMoney(somaPassagens)}</p>
            <p class="text-[10px] text-slate-400 mt-1">Bilhetes emitidos / estimados</p>
          </div>
          <div class="bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
            <p class="text-[11px] font-semibold uppercase text-emerald-400 font-bold">Custo Total Consolidado (R$)</p>
            <p class="text-2xl font-black text-emerald-400 mt-1">${formatMoney(somaTotal)}</p>
            <p class="text-[10px] text-slate-400 mt-1">Diárias + Passagens Aéreas</p>
          </div>
        </div>

        <!-- TABELA DE CUSTOS POR MISSÃO E POR MISSIONÁRIO -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[10px]">
                <tr>
                  <th class="py-3 px-3">Missão</th>
                  <th class="py-3 px-3">Servidor / Missionário</th>
                  <th class="py-3 px-3">Setor & Destino</th>
                  <th class="py-3 px-3">Transporte</th>
                  <th class="py-3 px-3">Período</th>
                  <th class="py-3 px-3">Diárias (Qtd)</th>
                  <th class="py-3 px-3">Unitária (R$)</th>
                  <th class="py-3 px-3">Total Diárias (R$)</th>
                  <th class="py-3 px-3">Passagens (R$)</th>
                  <th class="py-3 px-3">Custo Total</th>
                  <th class="py-3 px-3">Status</th>
                  <th class="py-3 px-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                ${items.length === 0 ? `
                  <tr><td colspan="12" class="text-center py-8 text-slate-500">Nenhum custo encontrado com os filtros selecionados.</td></tr>
                ` : items.map(it => `
                  <tr class="hover:bg-slate-800/40 transition">
                    <td class="py-3 px-3 font-mono font-bold text-pf-gold whitespace-nowrap">
                      ${it.codigo_missao}
                      <div class="text-[10px] font-normal text-slate-400 truncate max-w-[150px]">${it.titulo_missao}</div>
                    </td>
                    <td class="py-3 px-3 font-semibold text-white whitespace-nowrap">
                      ${it.servidor_nome}
                      <div class="text-[10px] text-slate-400 font-mono">Matrícula: ${it.servidor_matricula} [${it.cargo_sigla}]</div>
                    </td>
                    <td class="py-3 px-3 text-slate-200">
                      <span class="font-bold text-pf-gold">${it.setor_destino !== '-' ? it.setor_destino : ''}</span>
                      <div class="text-[10px] text-slate-400">${it.unidade_destino}</div>
                    </td>
                    <td class="py-3 px-3 whitespace-nowrap">
                      ${it.meio_transporte === 'AEREO' ? 
                        `<span class="bg-sky-950 border border-sky-800 text-sky-300 px-2 py-0.5 rounded text-[10px] font-bold">✈️ Aéreo</span>` : 
                        (it.meio_transporte === 'PROPRIO' ? 
                          `<span class="bg-purple-950 border border-purple-800 text-purple-300 px-2 py-0.5 rounded text-[10px] font-bold">🚙 Próprio</span>` : 
                          `<span class="bg-emerald-950 border border-emerald-800 text-emerald-300 px-2 py-0.5 rounded text-[10px] font-bold">🚗 Terrestre</span>`)}
                    </td>
                    <td class="py-3 px-3 text-slate-400 whitespace-nowrap text-[11px]">
                      ${formatDateBR(it.data_apresentacao)} a ${formatDateBR(it.data_retorno)}
                    </td>
                    <td class="py-3 px-3 font-bold text-slate-200 text-center">${it.qtd_diarias}d</td>
                    <td class="py-3 px-3 text-slate-300 font-mono text-[11px]">${formatMoney(it.valor_diaria_unitaria)}</td>
                    <td class="py-3 px-3 font-bold text-amber-300 font-mono">${formatMoney(it.total_diarias)}</td>
                    <td class="py-3 px-3 font-bold text-sky-300 font-mono">${formatMoney(it.valor_passagem_aerea)}</td>
                    <td class="py-3 px-3 font-black text-emerald-400 font-mono text-sm">${formatMoney(it.total_custo_individual)}</td>
                    <td class="py-3 px-3 whitespace-nowrap">
                      <span class="badge-status ${getStatusBadgeClass(it.status_atual)} text-[10px]">${it.status_atual}</span>
                    </td>
                    <td class="py-3 px-3 text-right whitespace-nowrap">
                      <button onclick="openMissaoDetail('${it.codigo_missao}')" class="px-2.5 py-1 bg-slate-800 hover:bg-pf-700 text-white rounded text-[11px] font-semibold transition">
                        Ver Missão
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao carregar custos: ${err.message}</div>`;
  }
}

function aplicarFiltrosCustos() {
  CUSTOS_FILTERS.busca = document.getElementById("custos-busca")?.value || "";
  CUSTOS_FILTERS.setor = document.getElementById("custos-setor")?.value || "";
  CUSTOS_FILTERS.meio_transporte = document.getElementById("custos-transporte")?.value || "";
  CUSTOS_FILTERS.unidade_pb = document.getElementById("custos-unidade-pb")?.value || "";
  CUSTOS_FILTERS.ano = document.getElementById("custos-ano")?.value || "";
  CUSTOS_FILTERS.mes = document.getElementById("custos-mes")?.value || "";
  renderCustos(document.getElementById("view-container"));
}

function limparFiltrosCustos() {
  CUSTOS_FILTERS = {
    ano: "2026",
    mes: "",
    setor: "",
    meio_transporte: "",
    unidade_pb: "",
    cargo: "",
    busca: ""
  };
  renderCustos(document.getElementById("view-container"));
}

// ==============================================================================
// 3. DETALHES E GESTÃO DA MISSÃO (COM CAMPO DE DIÁRIA E RBAC)
// ==============================================================================
async function openMissaoDetail(codigoOuId) {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContent.innerHTML = `<div class="p-8 text-center text-slate-400">Carregando detalhes da missão...</div>`;
  modalContainer.classList.remove("hidden");

  try {
    const m = await apiFetch(`/api/missoes/${codigoOuId}`);
    const servidores = await apiFetch("/api/servidores?ativo=true");
    const papeis = METADATA_CACHE.papeis.length ? METADATA_CACHE.papeis : await apiFetch("/api/missoes/meta/papeis");

    const isGerencial = CURRENT_USER && CURRENT_USER.role === "GERENCIAL";
    const isCadastrador = CURRENT_USER && CURRENT_USER.role === "CADASTRADOR";
    const isAdmin = CURRENT_USER && CURRENT_USER.role === "ADMIN";

    modalContent.innerHTML = `
      <div class="space-y-6">
        <!-- Modal Header -->
        <div class="flex items-start justify-between border-b border-slate-800 pb-4">
          <div>
            <div class="flex items-center space-x-3">
              <span class="font-mono text-xl font-bold text-pf-gold">${m.codigo_missao}</span>
              <span class="badge-status badge-${m.modalidade || 'INDIVIDUAL'}">${m.modalidade || 'INDIVIDUAL'}</span>
              <span class="badge-status ${getStatusBadgeClass(m.status_atual)}">${m.status_atual}</span>
            </div>
            <h2 class="text-lg font-bold text-white mt-1">${m.titulo}</h2>
            <p class="text-xs text-slate-400 mt-0.5">
              ${m.tipo_missao} • Solicitante: <strong class="text-slate-200">${m.unidade_solicitante}</strong> • Destino: <strong class="text-slate-200">${m.unidade_destino || m.localidade_descricao}</strong>
              ${m.setor_destino ? ` • Setor: <strong class="text-pf-gold">${m.setor_destino}</strong>` : ''}
              ${m.meio_transporte ? ` • Transporte: <strong class="text-sky-300">${m.meio_transporte === 'AEREO' ? '✈️ Aéreo' : (m.meio_transporte === 'PROPRIO' ? '🚙 Próprio' : '🚗 Terrestre')}</strong>` : ''}
              ${m.custo_estimado_passagens ? ` • Passagens: <strong class="text-sky-300">${formatMoney(m.custo_estimado_passagens)}</strong>` : ''}
            </p>
          </div>
          <button onclick="closeModal()" class="text-slate-400 hover:text-white p-1 rounded-lg">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        ${isGerencial ? `
          <div class="p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl text-blue-300 text-xs flex items-center space-x-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <span><strong>Modo Consulta Gerencial:</strong> Seu perfil possui acesso irrestrito para visualização e acompanhamento de relatórios, sem permissão de alteração de dados ou aprovações.</span>
          </div>
        ` : ''}

        <!-- Informações Administrativas & Responsáveis -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-950/80 p-4 rounded-xl border border-slate-800 text-xs">
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">Período Oficial</p>
            <p class="font-bold text-white mt-0.5">${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)} (${m.total_dias} dias)</p>
          </div>
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">Chefe / Responsável</p>
            <p class="font-bold text-slate-200 mt-0.5">${m.responsavel_nome ? `${m.responsavel_nome} (${m.responsavel_matricula})` : 'Não definido'}</p>
          </div>
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">Missionário Designado</p>
            <p class="font-bold ${m.modalidade === 'INDIVIDUAL' ? 'text-fuchsia-400' : 'text-slate-200'} mt-0.5">
              ${m.missionario_nome ? `${m.missionario_nome} (${m.missionario_matricula})` : (m.modalidade === 'INDIVIDUAL' ? 'Pendente' : 'Missão em Equipe')}
            </p>
          </div>
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">Ordem de Missão (OM) / SCDP</p>
            <p class="font-mono text-slate-200 mt-0.5">${m.numero_om || 'Não emitida'} / ${m.numero_pcdp || 'Pendente'}</p>
          </div>
        </div>

        <!-- CAMPO EDITÁVEL DO VALOR DA DIÁRIA DA MISSÃO -->
        <div class="bg-gradient-to-r from-pf-900/60 to-slate-950 border border-pf-gold/50 rounded-2xl p-5 shadow-lg">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div class="flex items-center space-x-2">
                <svg class="w-5 h-5 text-pf-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <h3 class="text-sm font-bold text-white uppercase tracking-wider">Campo Editável da Diária Desta Missão</h3>
              </div>
              <p class="text-xs text-slate-300 mt-1">Altere o valor unitário da diária específica desta missão. Todos os policiais serão recalculados!</p>
            </div>

            <div class="flex items-center space-x-2">
              <div class="relative">
                <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-xs text-slate-400 font-bold">R$</span>
                <input type="number" id="input-diaria-missao" step="0.50" min="0" value="${m.valor_diaria_padrao}"
                       ${isGerencial ? 'disabled' : ''}
                       class="w-32 bg-slate-900 border-2 border-pf-gold rounded-xl pl-8 pr-3 py-2 text-sm font-extrabold text-amber-300 focus:outline-none focus:ring-2 focus:ring-yellow-400">
              </div>
              ${!isGerencial ? `
                <button onclick="salvarNovoValorDiaria('${m.id}')"
                        class="bg-pf-gold hover:bg-yellow-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow transition flex items-center space-x-1">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                  <span>Recalcular Diárias</span>
                </button>
              ` : ''}
            </div>
          </div>
        </div>

        <!-- Transições de Ciclo de Vida (Com suporte aos status oficiais) -->
        <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
          <div class="flex items-center space-x-2">
            <span class="text-xs text-slate-400 font-semibold uppercase">Transição de Ciclo de Vida:</span>
            <span class="badge-status ${getStatusBadgeClass(m.status_atual)} text-[10px]">${m.status_atual}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            ${isGerencial ? `
              <span class="text-xs text-slate-500 italic">Transição bloqueada para perfil gerencial</span>
            ` : `
              <!-- Seletor Rápido de Todos os Status Oficiais -->
              <div class="flex items-center space-x-1">
                <select id="sel-mudar-status-oficial" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white">
                  <option value="">Alterar para Status Oficial...</option>
                  <option value="Indicado">Indicado</option>
                  <option value="Pendente de Alocação">Pendente de Alocação</option>
                  <option value="SAT pendente">SAT pendente</option>
                  <option value="SAT Atendida">SAT Atendida</option>
                  <option value="SAT Recusada">SAT Recusada</option>
                  <option value="SAT Reiterada">SAT Reiterada</option>
                  <option value="OM EMITIDA">OM EMITIDA</option>
                  <option value="PCDP CADASTRADA">PCDP CADASTRADA</option>
                  <option value="PCDP ENCAMINHADA">PCDP ENCAMINHADA</option>
                  <option value="PCDP PRESTAR CONTAS">PCDP PRESTAR CONTAS</option>
                  <option value="Concluído">Concluído</option>
                </select>
                <button onclick="mudarStatusMissaoOficial('${m.id}')" class="px-2.5 py-1 bg-pf-700 hover:bg-pf-600 text-white rounded-lg text-xs font-semibold transition">
                  Alterar
                </button>
              </div>

              <!-- Botões rápidos de fluxo -->
              ${m.status_atual === 'RASCUNHO' || m.status_atual === 'Indicado' ? `<button onclick="mudarStatusMissao('${m.id}', 'Pendente de Alocação')" class="px-3 py-1 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold">Alocar</button>` : ''}
              ${m.status_atual === 'Pendente de Alocação' ? `<button onclick="mudarStatusMissao('${m.id}', 'SAT pendente')" class="px-3 py-1 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold">Solicitar SAT</button>` : ''}
              ${m.status_atual === 'SAT pendente' ? `<button onclick="mudarStatusMissao('${m.id}', 'SAT Atendida')" class="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold">Atender SAT</button>` : ''}
              ${m.status_atual === 'SAT Atendida' || m.status_atual === 'APROVADA' ? `<button onclick="mudarStatusMissao('${m.id}', 'OM EMITIDA')" class="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-xs font-semibold">Emitir OM</button>` : ''}
              ${m.status_atual === 'OM EMITIDA' ? `<button onclick="mudarStatusMissao('${m.id}', 'PCDP CADASTRADA')" class="px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white rounded-lg text-xs font-semibold">Cadastrar PCDP</button>` : ''}
              ${m.status_atual === 'PCDP CADASTRADA' ? `<button onclick="mudarStatusMissao('${m.id}', 'PCDP ENCAMINHADA')" class="px-3 py-1 bg-teal-700 hover:bg-teal-600 text-white rounded-lg text-xs font-semibold">Encaminhar PCDP</button>` : ''}
              ${m.status_atual === 'PCDP ENCAMINHADA' ? `<button onclick="mudarStatusMissao('${m.id}', 'PCDP PRESTAR CONTAS')" class="px-3 py-1 bg-orange-700 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold">Prestar Contas</button>` : ''}
              ${m.status_atual === 'PCDP PRESTAR CONTAS' ? `<button onclick="mudarStatusMissao('${m.id}', 'Concluído')" class="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs font-semibold">Concluir Missão</button>` : ''}
              ${m.status_atual !== 'CANCELADA' && m.status_atual !== 'Concluído' ? `<button onclick="mudarStatusMissao('${m.id}', 'CANCELADA')" class="px-2 py-1 bg-red-900/60 hover:bg-red-800 text-red-200 rounded-lg text-xs font-semibold">Cancelar</button>` : ''}
            `}
          </div>
        </div>

        <!-- Participants Table -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-white uppercase tracking-wider">
                ${m.modalidade === 'INDIVIDUAL' ? 'Missionário Único Designado' : `Servidores Designados (${m.participantes.length})`}
              </h3>
              <p class="text-xs text-slate-400">
                ${m.modalidade === 'INDIVIDUAL' ? 
                  'Missão individual vinculada exclusivamente ao policial missionário designado com cálculo automático de diárias.' : 
                  'Relação de policiais, meios de transporte, localizador e cálculo de diárias.'}
              </p>
            </div>
            ${(!isGerencial && m.modalidade !== 'INDIVIDUAL') ? `
              <button onclick="toggleFormNovoParticipante()" class="bg-pf-700 hover:bg-pf-600 text-white font-bold px-3 py-1.5 rounded-xl text-xs uppercase tracking-wider transition flex items-center space-x-1">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
                <span>Adicionar Servidor</span>
              </button>
            ` : ''}
          </div>

          <!-- Add Participant Form (Only for EQUIPE) -->
          <div id="form-novo-participante" class="hidden bg-slate-950 p-4 rounded-xl border border-pf-600/50 space-y-3">
            <h4 class="text-xs font-bold text-pf-gold uppercase">Designar Novo Servidor para esta Missão</h4>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <label class="block text-slate-400 mb-1">Servidor Policial</label>
                <select id="part-matricula" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  ${servidores.map(s => `
                    <option value="${s.matricula}">[${s.cargo_sigla}] ${s.nome_completo} (${s.unidade_sigla})</option>
                  `).join('')}
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1">Papel na Missão</label>
                <select id="part-papel" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  ${papeis.map(p => `<option value="${p.nome}">${p.nome}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1">Meio de Transporte</label>
                <select id="part-transporte" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  <option value="AEREO">Aéreo (Passagem Comercial)</option>
                  <option value="VIATURA_OFICIAL">Viatura Oficial PF</option>
                  <option value="FLUVIAL">Fluvial (Barco/Lancha PF)</option>
                  <option value="MISTO">Misto</option>
                  <option value="OUTRO">Outro Deslocamento</option>
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1">Data Apresentação</label>
                <input type="date" id="part-dt-apres" value="${m.data_inicio}" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              </div>
              <div>
                <label class="block text-slate-400 mb-1">Data Retorno</label>
                <input type="date" id="part-dt-ret" value="${m.data_termino}" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              </div>
              <div>
                <label class="block text-slate-400 mb-1">Valor Diária Unitária (R$)</label>
                <input type="number" id="part-valor-diaria" step="0.50" value="${m.valor_diaria_padrao}" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-bold text-amber-300">
              </div>
              <div>
                <label class="block text-slate-400 mb-1">Custo Passagem Aérea (R$)</label>
                <input type="number" id="part-passagem" step="10.00" value="0.00" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              </div>
              <div>
                <label class="block text-slate-400 mb-1">Localizador Aéreo</label>
                <input type="text" id="part-localizador" placeholder="Ex: ABC12D" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono uppercase">
              </div>
              <div class="flex items-center pt-5 space-x-2">
                <input type="checkbox" id="part-is-sede" class="rounded bg-slate-900 border-slate-700 text-pf-gold focus:ring-0">
                <label for="part-is-sede" class="text-slate-300 text-xs">Efetivo Local / Sede (Zero Diárias)</label>
              </div>
            </div>
            <div class="flex justify-end space-x-2 pt-2">
              <button onclick="toggleFormNovoParticipante()" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold">Cancelar</button>
              <button onclick="salvarNovoParticipante('${m.id}')" class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shadow">Confirmar Designação</button>
            </div>
          </div>

          <!-- Participants Table -->
          <div class="overflow-x-auto bg-slate-950/80 rounded-xl border border-slate-800 shadow">
            <table class="w-full text-left text-xs">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[10px]">
                <tr>
                  <th class="py-2.5 px-3">Servidor</th>
                  <th class="py-2.5 px-3">Papel / Transporte</th>
                  <th class="py-2.5 px-3">Período</th>
                  <th class="py-2.5 px-3">Diárias (Qtd)</th>
                  <th class="py-2.5 px-3">Valor Unit. (R$)</th>
                  <th class="py-2.5 px-3">Total Diárias</th>
                  <th class="py-2.5 px-3">Passagem</th>
                  <th class="py-2.5 px-3">Custo Total</th>
                  ${!isGerencial && m.modalidade !== 'INDIVIDUAL' ? '<th class="py-2.5 px-3 text-right">Ação</th>' : ''}
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                ${m.participantes.map(p => `
                  <tr class="hover:bg-slate-800/40 transition">
                    <td class="py-3 px-3">
                      <p class="font-bold text-white">[${p.servidor_cargo || ''}] ${p.servidor_nome || p.servidor_matricula}</p>
                      <p class="text-[11px] text-slate-400">Matrícula: ${p.servidor_matricula} • Lotação: ${p.servidor_lotacao || '-'}</p>
                    </td>
                    <td class="py-3 px-3">
                      <p class="font-medium text-slate-200">${p.papel}</p>
                      <p class="text-[11px] text-slate-400">${p.meio_transporte} ${p.localizador_aereo ? `• Loc: <span class="font-mono text-pf-gold font-bold">${p.localizador_aereo}</span>` : ''}</p>
                    </td>
                    <td class="py-3 px-3 text-slate-300">
                      ${formatDateBR(p.data_apresentacao)} a ${formatDateBR(p.data_retorno)}
                      <span class="text-slate-500">(${p.dias_participacao}d)</span>
                    </td>
                    <td class="py-3 px-3">
                      ${p.is_missao_sede ? 
                        `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 border border-slate-700 text-slate-400">SEDE (0,0)</span>` : 
                        `<span class="font-bold text-amber-300">${p.qtd_diarias} diárias</span>`
                      }
                    </td>
                    <td class="py-3 px-3 font-semibold text-slate-300">
                      ${p.is_missao_sede ? 'R$ 0,00' : formatMoney(p.valor_diaria_unitaria)}
                    </td>
                    <td class="py-3 px-3 font-bold ${p.is_missao_sede ? 'text-slate-400' : 'text-amber-400'}">
                      ${formatMoney(p.valor_total_diarias)}
                    </td>
                    <td class="py-3 px-3 text-slate-300">${formatMoney(p.valor_passagem_aerea)}</td>
                    <td class="py-3 px-3 font-extrabold text-emerald-400">${formatMoney(p.custo_total_servidor)}</td>
                    ${!isGerencial && m.modalidade !== 'INDIVIDUAL' ? `
                      <td class="py-3 px-3 text-right">
                        <button onclick="removerParticipante('${m.id}', '${p.id}')" class="p-1 text-slate-500 hover:text-red-400 rounded transition" title="Remover participante">
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                      </td>
                    ` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Financial Summary Banner of Mission -->
        <div class="flex items-center justify-between bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs">
          <div>
            <p class="text-slate-400 uppercase font-semibold text-[10px]">Custo Geral Desta Missão</p>
            <p class="text-lg font-extrabold text-emerald-400">${formatMoney(m.total_custo_geral)}</p>
          </div>
          <div class="flex space-x-6 text-right">
            <div>
              <p class="text-slate-500 text-[10px]">Subtotal Diárias:</p>
              <p class="font-bold text-amber-300">${formatMoney(m.total_custo_diarias)}</p>
            </div>
            <div>
              <p class="text-slate-500 text-[10px]">Subtotal Passagens:</p>
              <p class="font-bold text-blue-300">${formatMoney(m.total_custo_passagens)}</p>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    modalContent.innerHTML = `<div class="p-6 text-red-300 text-xs">Erro ao carregar missão: ${err.message}</div>`;
  }
}

function toggleFormNovoParticipante() {
  const el = document.getElementById("form-novo-participante");
  if (el) el.classList.toggle("hidden");
}

async function salvarNovoValorDiaria(missaoId) {
  const input = document.getElementById("input-diaria-missao");
  const novoValor = parseFloat(input.value);
  if (isNaN(novoValor) || novoValor < 0) {
    alert("Informe um valor numérico válido para a diária.");
    return;
  }

  try {
    await apiFetch(`/api/missoes/${missaoId}/valor-diaria`, {
      method: "PATCH",
      body: JSON.stringify({
        novo_valor_diaria: novoValor,
        recalcular_participantes: true
      })
    });
    alert(`Diária da missão atualizada para ${formatMoney(novoValor)}. Todos os participantes foram recalculados com sucesso!`);
    await openMissaoDetail(missaoId);
  } catch (err) {
    alert(`Erro ao atualizar diária: ${err.message}`);
  }
}

async function mudarStatusMissao(missaoId, novoStatus) {
  const motivo = prompt(`Confirmar alteração de status para '${novoStatus}'? Justificativa opcional:`, "Conformidade operacional");
  if (motivo === null) return;

  try {
    await apiFetch(`/api/missoes/${missaoId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ novo_status: novoStatus, justificativa: motivo })
    });
    await openMissaoDetail(missaoId);
  } catch (err) {
    alert(`Erro ao alterar status: ${err.message}`);
  }
}

async function mudarStatusMissaoOficial(missaoId) {
  const sel = document.getElementById("sel-mudar-status-oficial");
  const novoStatus = sel ? sel.value : "";
  if (!novoStatus) {
    alert("Selecione um status oficial para prosseguir.");
    return;
  }
  await mudarStatusMissao(missaoId, novoStatus);
}

async function salvarNovoParticipante(missaoId) {
  const matricula = document.getElementById("part-matricula").value;
  const papel = document.getElementById("part-papel").value;
  const meio_transporte = document.getElementById("part-transporte").value;
  const data_apresentacao = document.getElementById("part-dt-apres").value;
  const data_retorno = document.getElementById("part-dt-ret").value;
  const valor_diaria_unitaria = parseFloat(document.getElementById("part-valor-diaria").value || 0);
  const valor_passagem_aerea = parseFloat(document.getElementById("part-passagem").value || 0);
  const localizador_aereo = document.getElementById("part-localizador").value.trim().toUpperCase();
  const is_missao_sede = document.getElementById("part-is-sede").checked;

  try {
    await apiFetch(`/api/missoes/${missaoId}/participantes`, {
      method: "POST",
      body: JSON.stringify({
        servidor_matricula: matricula,
        papel,
        meio_transporte,
        data_apresentacao,
        data_retorno,
        valor_diaria_unitaria,
        valor_passagem_aerea,
        localizador_aereo,
        is_missao_sede
      })
    });
    await openMissaoDetail(missaoId);
  } catch (err) {
    alert(`Falha ao designar servidor: ${err.message}`);
  }
}

async function removerParticipante(missaoId, partId) {
  if (!confirm("Deseja realmente remover esta designação de servidor da missão?")) return;
  try {
    await apiFetch(`/api/missoes/${missaoId}/participantes/${partId}`, { method: "DELETE" });
    await openMissaoDetail(missaoId);
  } catch (err) {
    alert(`Erro ao remover: ${err.message}`);
  }
}

// Modal Nova Missão (Com suporte a Missão Individual como padrão, transporte, passagens, múltiplos servidores e sub-modal)
async function openModalNovaMissao() {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContainer.classList.remove("hidden");

  const unidades = METADATA_CACHE.unidades.length ? METADATA_CACHE.unidades : await apiFetch("/api/missoes/meta/unidades");
  const tipos = METADATA_CACHE.tipos.length ? METADATA_CACHE.tipos : await apiFetch("/api/missoes/meta/tipos");
  const setores = METADATA_CACHE.setores.length ? METADATA_CACHE.setores : await apiFetch("/api/missoes/meta/setores").catch(() => []);
  const servidores = await apiFetch("/api/servidores?ativo=true");
  const diariaBase = SYSTEM_CONFIG.valor_diaria_padrao || "425.00";

  const proxCod = `MIS-2026-00${Math.floor(Math.random() * 900 + 100)}`;

  modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <h2 class="text-base font-bold text-white">Abertura de Nova Missão Institucional</h2>
          <p class="text-xs text-slate-400">Padrão Individual (1 servidor) ou Coletiva (Equipe com múltiplos servidores)</p>
        </div>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white text-lg">&times;</button>
      </div>

      <form id="form-criar-missao" class="space-y-3 text-xs">
        <!-- MODALIDADE SELETOR (INDIVIDUAL É O PADRÃO CONFORME ESPECIFICAÇÃO) -->
        <div class="bg-slate-950 p-3 rounded-xl border border-pf-gold/50 flex flex-col md:flex-row md:items-center justify-between gap-2 shadow">
          <div>
            <span class="font-bold text-white uppercase text-xs">Modalidade Operacional da Missão:</span>
            <p class="text-[11px] text-slate-400" id="modalidade-hint">Missão Individual como padrão (1 policial missionário) ou Missão em Equipe (múltiplos servidores).</p>
          </div>
          <div class="flex items-center space-x-4">
            <label class="flex items-center space-x-1.5 cursor-pointer">
              <input type="radio" name="nova-modalidade" value="INDIVIDUAL" checked onchange="toggleModalidadeFields()" class="text-pf-gold focus:ring-0">
              <span class="font-bold text-fuchsia-300">👤 Individual (Padrão)</span>
            </label>
            <label class="flex items-center space-x-1.5 cursor-pointer">
              <input type="radio" name="nova-modalidade" value="EQUIPE" onchange="toggleModalidadeFields()" class="text-pf-gold focus:ring-0">
              <span class="font-bold text-blue-300">👥 Equipe Policial</span>
            </label>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Código da Missão</label>
            <input type="text" id="nova-codigo" value="${proxCod}" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono font-bold text-pf-gold">
          </div>
          <div class="md:col-span-2">
            <label class="block text-slate-400 mb-1">Título da Missão</label>
            <input type="text" id="nova-titulo" placeholder="Ex: Operação Fronteira Segura 2026 / Diligência Específica" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Tipo de Missão</label>
            <select id="nova-tipo" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              ${tipos.map(t => `<option value="${t.nome}">${t.nome}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Unidade Solicitante (PB no topo)</label>
            <select id="nova-solicitante" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              ${unidades.map(u => `<option value="${u.sigla}">${u.sigla} - ${u.nome_extenso}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Unidade de Destino</label>
            <select id="nova-destino" onchange="autoAjustarDiariaPorDestino()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              <option value="">Nenhuma / Área Externa</option>
              ${unidades.map(u => `<option value="${u.sigla}">${u.sigla} - ${u.nome_extenso}</option>`).join('')}
            </select>
            <p id="badge-destino-diaria" class="hidden text-[10px] text-pf-gold font-semibold mt-1"></p>
          </div>

          <!-- MEIO DE TRANSPORTE E ESTIMATIVA DE PASSAGENS AÉREAS -->
          <div>
            <label class="block text-slate-400 mb-1">Meio de Transporte</label>
            <select id="nova-transporte" onchange="toggleNovaMissaoTransporte()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
              <option value="AEREO">✈️ Aéreo (Comercial)</option>
              <option value="TERRESTRE">🚗 Terrestre / Viatura Oficial</option>
              <option value="PROPRIO">🚙 Veículo Próprio</option>
            </select>
          </div>

          <div id="container-custo-passagens">
            <label class="block text-slate-400 mb-1">Estimativa Custo Passagens Aéreas (R$)</label>
            <input type="number" id="nova-custo-passagens" step="10.00" value="1500.00" class="w-full bg-slate-900 border-2 border-sky-500 rounded-lg p-2 text-sky-300 font-bold">
          </div>

          <!-- SETOR DE DESTINO DA SR/PB -->
          <div>
            <label class="block text-slate-400 mb-1">Setor de Destino (SR/PF/PB)</label>
            <select id="nova-setor" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              <option value="">Nenhum / Não aplicável</option>
              ${setores.map(s => `<option value="${s.sigla}">${s.sigla} - ${s.nome}</option>`).join('')}
            </select>
          </div>

          <div class="md:col-span-3">
            <label class="block text-slate-400 mb-1">Localidade de Execução</label>
            <input type="text" id="nova-localidade" placeholder="Ex: Superintendência Regional da PF em João Pessoa/PB" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Data de Início</label>
            <input type="date" id="nova-dt-inicio" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Data de Término</label>
            <input type="date" id="nova-dt-termino" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Valor Diária Unitária Desta Missão (R$)</label>
            <input type="number" id="nova-diaria-padrao" step="0.50" value="${diariaBase}" required class="w-full bg-slate-900 border-2 border-pf-gold rounded-lg p-2 text-amber-300 font-extrabold">
          </div>

          <!-- CHEFE / RESPONSÁVEL -->
          <div>
            <label class="block text-slate-400 mb-1">Chefe da Missão / Autoridade Solicitante</label>
            <select id="nova-responsavel" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              <option value="">Selecione...</option>
              ${servidores.map(s => `<option value="${s.matricula}">[${s.cargo_sigla}] ${s.nome_completo} (${s.unidade_sigla})</option>`).join('')}
            </select>
          </div>

          <!-- CONTAINER MISSÃO INDIVIDUAL (PADRÃO) -->
          <div id="container-nova-missionario" class="md:col-span-2">
            <div class="flex items-center justify-between mb-1">
              <label class="block text-fuchsia-300 font-bold" id="label-nova-missionario">* Policial Missionário Designado (Individual)</label>
              <button type="button" onclick="openSubModalNovoServidor('nova-missionario')" class="text-pf-gold hover:underline text-[11px] font-bold">
                + Cadastrar Novo Servidor
              </button>
            </div>
            <input type="text" id="filtro-busca-missionario" oninput="filtrarOpcoesMissionario()" placeholder="🔍 Pesquisar policial por nome, cargo ou matrícula..." class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 mb-1 text-xs text-white">
            <select id="nova-missionario" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-medium">
              <option value="">Selecione o servidor executor...</option>
              ${servidores.map(s => `<option value="${s.matricula}">[${s.cargo_sigla}] ${s.nome_completo} (${s.unidade_sigla}) - Matrícula ${s.matricula}</option>`).join('')}
            </select>
          </div>

          <!-- CONTAINER MISSÃO EM EQUIPE (MÚLTIPLOS SERVIDORES) -->
          <div id="container-equipe-multi" class="hidden md:col-span-3 bg-slate-950 p-4 rounded-xl border border-blue-800 space-y-2">
            <div class="flex items-center justify-between">
              <div>
                <span class="font-bold text-blue-300 text-xs uppercase">Designar Servidores da Equipe (Múltiplos)</span>
                <p class="text-[11px] text-slate-400">Marque todos os policiais que integrarão a equipe desta missão:</p>
              </div>
              <button type="button" onclick="openSubModalNovoServidor('equipe-servidores')" class="px-2.5 py-1 bg-pf-800 hover:bg-pf-700 text-pf-gold border border-pf-gold/50 rounded-lg text-xs font-bold transition">
                + Cadastrar Novo Servidor
              </button>
            </div>
            <input type="text" id="filtro-busca-equipe" oninput="filtrarOpcoesEquipe()" placeholder="🔍 Filtrar servidores disponíveis..." class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white">
            <div id="lista-equipe-servidores" class="max-h-48 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2 p-2 bg-slate-900 rounded-lg border border-slate-800">
              ${servidores.map(s => `
                <label class="equipe-srv-item flex items-center space-x-2 p-1.5 rounded hover:bg-slate-800 cursor-pointer" data-search="${s.nome_completo.toLowerCase()} ${s.matricula} ${s.cargo_sigla.toLowerCase()}">
                  <input type="checkbox" name="chk-equipe-srv" value="${s.matricula}" class="rounded bg-slate-950 border-slate-700 text-pf-gold focus:ring-0">
                  <span class="text-xs text-slate-200 truncate">[${s.cargo_sigla}] ${s.nome_completo} <span class="text-[10px] text-slate-400">(${s.matricula})</span></span>
                </label>
              `).join('')}
            </div>
          </div>

          <div>
            <label class="block text-slate-400 mb-1">Processo SEI</label>
            <input type="text" id="nova-sei" placeholder="08200.000000/2026-00" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Nº Solicitação SAT</label>
            <input type="text" id="nova-sat" placeholder="SAT-2026-0000" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Ordem de Missão (OM)</label>
            <input type="text" id="nova-om" placeholder="OM-2026-0000" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>

          <div class="md:col-span-3">
            <label class="block text-slate-400 mb-1">Justificativa da Missão</label>
            <textarea id="nova-justificativa" rows="2" placeholder="Fundamentação de interesse público e objetivos operacionais..." required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"></textarea>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-slate-800">
          <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold">Cancelar</button>
          <button type="submit" class="px-5 py-2 bg-gradient-to-r from-pf-gold to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-slate-950 font-bold rounded-xl shadow">Cadastrar Missão</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("form-criar-missao").addEventListener("submit", async (e) => {
    e.preventDefault();
    const modalidade = document.querySelector('input[name="nova-modalidade"]:checked').value;
    const missionarioMatricula = document.getElementById("nova-missionario").value || null;
    const meioTransporte = document.getElementById("nova-transporte").value;
    const custoPassagens = meioTransporte === "AEREO" ? parseFloat(document.getElementById("nova-custo-passagens").value || 0) : 0;
    const setorDestino = document.getElementById("nova-setor").value || null;

    let equipeMatriculas = [];
    if (modalidade === "EQUIPE") {
      document.querySelectorAll('input[name="chk-equipe-srv"]:checked').forEach(chk => {
        equipeMatriculas.push(chk.value);
      });
    }

    if (modalidade === "INDIVIDUAL" && !missionarioMatricula) {
      alert("Para missões na modalidade INDIVIDUAL, é obrigatório selecionar o Missionário Designado.");
      return;
    }

    const payload = {
      codigo_missao: document.getElementById("nova-codigo").value.trim(),
      titulo: document.getElementById("nova-titulo").value.trim(),
      tipo_missao: document.getElementById("nova-tipo").value,
      modalidade: modalidade,
      unidade_solicitante: document.getElementById("nova-solicitante").value,
      unidade_destino: document.getElementById("nova-destino").value || null,
      setor_destino: setorDestino,
      meio_transporte: meioTransporte,
      custo_estimado_passagens: custoPassagens,
      localidade_descricao: document.getElementById("nova-localidade").value.trim(),
      data_inicio: document.getElementById("nova-dt-inicio").value,
      data_termino: document.getElementById("nova-dt-termino").value,
      valor_diaria_padrao: parseFloat(document.getElementById("nova-diaria-padrao").value || 425),
      responsavel_matricula: document.getElementById("nova-responsavel").value || null,
      missionario_matricula: missionarioMatricula,
      servidores_equipe_matriculas: equipeMatriculas,
      numero_om: document.getElementById("nova-om").value.trim() || null,
      processo_sei: document.getElementById("nova-sei").value.trim() || null,
      numero_sat: document.getElementById("nova-sat").value.trim() || null,
      justificativa: document.getElementById("nova-justificativa").value.trim(),
      status_atual: "Indicado"
    };

    try {
      const criada = await apiFetch("/api/missoes", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      closeModal();
      navigate("missoes");
      openMissaoDetail(criada.codigo_missao);
    } catch (err) {
      alert(`Erro ao criar missão: ${err.message}`);
    }
  });
}

function toggleModalidadeFields() {
  const modalidade = document.querySelector('input[name="nova-modalidade"]:checked').value;
  const hint = document.getElementById("modalidade-hint");
  const containerMissionario = document.getElementById("container-nova-missionario");
  const containerEquipe = document.getElementById("container-equipe-multi");

  if (modalidade === "INDIVIDUAL") {
    hint.innerHTML = `<strong class="text-fuchsia-400">Missão Individual (Padrão):</strong> O policial selecionado como missionário será automaticamente cadastrado como único participante com cálculo de diárias e passagens.`;
    if (containerMissionario) containerMissionario.classList.remove("hidden");
    if (containerEquipe) containerEquipe.classList.add("hidden");
  } else {
    hint.innerHTML = `<strong class="text-blue-400">Missão em Equipe:</strong> Selecione abaixo os servidores que integrarão a equipe desta missão coletiva.`;
    if (containerMissionario) containerMissionario.classList.add("hidden");
    if (containerEquipe) containerEquipe.classList.remove("hidden");
  }
}

function toggleNovaMissaoTransporte() {
  const transporte = document.getElementById("nova-transporte")?.value;
  const containerPassagem = document.getElementById("container-custo-passagens");
  if (containerPassagem) {
    if (transporte === "AEREO") {
      containerPassagem.classList.remove("hidden");
    } else {
      containerPassagem.classList.add("hidden");
      const inp = document.getElementById("nova-custo-passagens");
      if (inp) inp.value = "0.00";
    }
  }
}

function autoAjustarDiariaPorDestino() {
  const destino = document.getElementById("nova-destino")?.value;
  const diariaInput = document.getElementById("nova-diaria-padrao");
  const badgeInfo = document.getElementById("badge-destino-diaria");
  if (!destino || !diariaInput) return;
  const u = METADATA_CACHE.unidades.find(x => x.sigla === destino);
  if (u && u.valor_diaria) {
    diariaInput.value = parseFloat(u.valor_diaria).toFixed(2);
    if (badgeInfo) {
      badgeInfo.textContent = `✓ Valor automático para ${u.sigla}: R$ ${parseFloat(u.valor_diaria).toFixed(2)} (${u.categoria_diaria || u.tipo_unidade || 'Tabela Oficial'})`;
      badgeInfo.classList.remove("hidden");
    }
  } else if (badgeInfo) {
    badgeInfo.classList.add("hidden");
  }
}

function filtrarOpcoesMissionario() {
  const term = document.getElementById("filtro-busca-missionario")?.value.toLowerCase() || "";
  const select = document.getElementById("nova-missionario");
  if (!select) return;
  for (let opt of select.options) {
    if (!opt.value) continue;
    const match = opt.text.toLowerCase().includes(term);
    opt.style.display = match ? "" : "none";
  }
}

function filtrarOpcoesEquipe() {
  const term = document.getElementById("filtro-busca-equipe")?.value.toLowerCase() || "";
  document.querySelectorAll(".equipe-srv-item").forEach(item => {
    const txt = item.getAttribute("data-search") || "";
    item.style.display = txt.includes(term) ? "flex" : "none";
  });
}

// Sub-modal para cadastro rápido de novo servidor sem perder o contexto da missão
function openSubModalNovoServidor(targetSelectOrListId) {
  const subModal = document.createElement("div");
  subModal.id = "submodal-novo-servidor";
  subModal.className = "fixed inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center z-50 p-4";
  subModal.innerHTML = `
    <div class="bg-slate-900 border border-pf-gold rounded-2xl shadow-2xl max-w-lg w-full p-6 text-xs space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h3 class="text-sm font-bold text-white uppercase tracking-wider">⚡ Inserção Rápida de Servidor Policial</h3>
        <button onclick="document.getElementById('submodal-novo-servidor').remove()" class="text-slate-400 hover:text-white text-base font-bold">&times;</button>
      </div>

      <form id="form-sub-servidor" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Matrícula Funcional</label>
            <input type="text" id="sub-srv-matricula" required placeholder="Ex: 31450" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Cargo / Carreira</label>
            <select id="sub-srv-cargo" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white">
              ${METADATA_CACHE.cargos.map(c => `<option value="${c.sigla}">${c.sigla} - ${c.descricao}</option>`).join('')}
            </select>
          </div>
          <div class="col-span-2">
            <label class="block text-slate-400 mb-1">Nome Completo</label>
            <input type="text" id="sub-srv-nome" required placeholder="NOME DO POLICIAL FEDERAL" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white font-semibold uppercase">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Unidade de Lotação</label>
            <select id="sub-srv-unidade" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white">
              ${METADATA_CACHE.unidades.map(u => `<option value="${u.sigla}">${u.sigla}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">E-mail Institucional</label>
            <input type="email" id="sub-srv-email" required placeholder="policial.xyz@pf.gov.br" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white">
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-slate-800">
          <button type="button" onclick="document.getElementById('submodal-novo-servidor').remove()" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold">Cancelar</button>
          <button type="submit" class="px-4 py-1.5 bg-pf-gold hover:bg-yellow-400 text-slate-950 font-bold rounded-lg shadow">Salvar e Selecionar</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(subModal);

  document.getElementById("form-sub-servidor").addEventListener("submit", async (e) => {
    e.preventDefault();
    const matricula = document.getElementById("sub-srv-matricula").value.trim();
    const nome = document.getElementById("sub-srv-nome").value.trim().toUpperCase();
    const cargo = document.getElementById("sub-srv-cargo").value;
    const unidade = document.getElementById("sub-srv-unidade").value;
    const email = document.getElementById("sub-srv-email").value.trim().toLowerCase();

    try {
      const criado = await apiFetch("/api/servidores", {
        method: "POST",
        body: JSON.stringify({
          matricula,
          nome_completo: nome,
          cargo_sigla: cargo,
          unidade_sigla: unidade,
          email_institucional: email,
          ativo: true,
          is_missionario_geral: true
        })
      });

      // Atualizar o select do missionário individual
      const selectMissionario = document.getElementById("nova-missionario");
      if (selectMissionario) {
        const opt = document.createElement("option");
        opt.value = criado.matricula;
        opt.text = `[${criado.cargo_sigla}] ${criado.nome_completo} (${criado.unidade_sigla}) - Matrícula ${criado.matricula}`;
        opt.selected = true;
        selectMissionario.appendChild(opt);
      }

      // Se for lista de equipe, adicionar checkbox marcado
      const listaEquipe = document.getElementById("lista-equipe-servidores");
      if (listaEquipe) {
        const itemLabel = document.createElement("label");
        itemLabel.className = "equipe-srv-item flex items-center space-x-2 p-1.5 rounded hover:bg-slate-800 cursor-pointer bg-blue-950/40 border border-blue-700";
        itemLabel.setAttribute("data-search", `${criado.nome_completo.toLowerCase()} ${criado.matricula} ${criado.cargo_sigla.toLowerCase()}`);
        itemLabel.innerHTML = `
          <input type="checkbox" name="chk-equipe-srv" value="${criado.matricula}" checked class="rounded bg-slate-950 border-slate-700 text-pf-gold focus:ring-0">
          <span class="text-xs text-slate-200 truncate">[${criado.cargo_sigla}] ${criado.nome_completo} <span class="text-[10px] text-slate-400">(${criado.matricula})</span></span>
        `;
        listaEquipe.prepend(itemLabel);
      }

      subModal.remove();
      alert(`Servidor '${criado.nome_completo}' cadastrado e selecionado com sucesso!`);
    } catch (err) {
      alert(`Erro ao cadastrar servidor: ${err.message}`);
    }
  });
}

// ==============================================================================
// 4. CADASTRO DE SERVIDORES (COM FILTROS COMPLETOS)
// ==============================================================================
async function renderServidores(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando servidores da Polícia Federal...</div>`;
  try {
    const servidores = await apiFetch("/api/servidores");
    const cargos = METADATA_CACHE.cargos.length ? METADATA_CACHE.cargos : await apiFetch("/api/missoes/meta/cargos");
    const unidades = METADATA_CACHE.unidades.length ? METADATA_CACHE.unidades : await apiFetch("/api/missoes/meta/unidades");

    const podeCriar = CURRENT_USER && (CURRENT_USER.role === "ADMIN" || CURRENT_USER.role === "CADASTRADOR");

    container.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <!-- Header Info & Filtros -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 class="text-sm font-bold text-white uppercase tracking-wider">Efetivo Policial e Administrativo</h3>
              <p class="text-xs text-slate-400">Cadastro de policiais federais e servidores operacionais</p>
            </div>
            ${podeCriar ? `
              <button onclick="openModalNovoServidor()" class="bg-pf-700 hover:bg-pf-600 text-white font-bold px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow flex items-center space-x-1.5 transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                <span>Novo Servidor</span>
              </button>
            ` : `
              <span class="px-3 py-1 bg-slate-800 text-slate-400 text-xs rounded-xl font-semibold border border-slate-700">
                🔒 Somente Leitura
              </span>
            `}
          </div>

          <!-- Filtros de Servidores -->
          <div class="grid grid-cols-1 md:grid-cols-6 gap-2 text-xs pt-2 border-t border-slate-800/80">
            <div>
              <input type="text" id="filtro-srv-busca" placeholder="Buscar por matrícula, nome, guerra..."
                     class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pf-gold">
            </div>
            <div>
              <select id="filtro-srv-cargo" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300">
                <option value="">Todos os Cargos</option>
                ${cargos.map(c => `<option value="${c.sigla}">${c.sigla} - ${c.descricao}</option>`).join('')}
              </select>
            </div>
            <div>
              <select id="filtro-srv-unidade" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300">
                <option value="">Todas as Unidades</option>
                ${unidades.map(u => `<option value="${u.sigla}">${u.sigla}</option>`).join('')}
              </select>
            </div>
            <div>
              <select id="filtro-srv-status" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300">
                <option value="">Todos os Status</option>
                <option value="true">Somente Ativos</option>
                <option value="false">Inativos</option>
              </select>
            </div>
            <div>
              <select id="filtro-srv-tpe" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300">
                <option value="">Todos Docentes (TPE)</option>
                <option value="true">Sim (Docente)</option>
                <option value="false">Não</option>
              </select>
            </div>
            <div>
              <select id="filtro-srv-miss" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300">
                <option value="">Todos Missionários</option>
                <option value="true">Geral (Com Diárias)</option>
                <option value="false">Local (Sem Diárias)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[11px]">
                <tr>
                  <th class="py-3 px-3">Matrícula</th>
                  <th class="py-3 px-3">Nome Completo / Guerra</th>
                  <th class="py-3 px-3">Cargo / Carreira</th>
                  <th class="py-3 px-3">Unidade de Lotação</th>
                  <th class="py-3 px-3">Contato / E-mail</th>
                  <th class="py-3 px-3">TPE (Docente)</th>
                  <th class="py-3 px-3">Missionário Geral</th>
                  <th class="py-3 px-3">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60" id="servidores-tbody">
                ${renderServidoresRows(servidores)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const onSrvFilter = () => applyServidoresFilter(servidores);
    document.getElementById("filtro-srv-busca").addEventListener("input", onSrvFilter);
    document.getElementById("filtro-srv-cargo").addEventListener("change", onSrvFilter);
    document.getElementById("filtro-srv-unidade").addEventListener("change", onSrvFilter);
    document.getElementById("filtro-srv-status").addEventListener("change", onSrvFilter);
    document.getElementById("filtro-srv-tpe").addEventListener("change", onSrvFilter);
    document.getElementById("filtro-srv-miss").addEventListener("change", onSrvFilter);

  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao listar servidores: ${err.message}</div>`;
  }
}

function renderServidoresRows(servidores) {
  if (servidores.length === 0) {
    return `<tr><td colspan="8" class="text-center py-8 text-slate-500">Nenhum servidor encontrado.</td></tr>`;
  }
  return servidores.map(s => `
    <tr class="hover:bg-slate-800/40 transition">
      <td class="py-3 px-3 font-mono font-bold text-pf-gold">${s.matricula}</td>
      <td class="py-3 px-3">
        <p class="font-bold text-white">${s.nome_completo}</p>
        ${s.nome_guerra ? `<p class="text-[11px] text-slate-400 font-mono">(${s.nome_guerra})</p>` : ''}
      </td>
      <td class="py-3 px-3">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-blue-300 border border-slate-700">
          ${s.cargo_sigla}
        </span>
      </td>
      <td class="py-3 px-3 font-semibold text-slate-200">${s.unidade_sigla}</td>
      <td class="py-3 px-3 text-slate-300">
        <p>${s.email_institucional}</p>
        <p class="text-[11px] text-slate-500">${s.telefone_celular || '-'}</p>
      </td>
      <td class="py-3 px-3">
        ${s.tpe ? 
          `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 border border-emerald-800 text-emerald-300">Sim (Habilitado)</span>` : 
          `<span class="text-slate-500">Não</span>`}
      </td>
      <td class="py-3 px-3">
        ${s.is_missionario_geral ? 
          `<span class="text-emerald-400 font-bold">Sim (Com Diárias)</span>` : 
          `<span class="text-amber-400 font-semibold">Local (Sem Diárias)</span>`}
      </td>
      <td class="py-3 px-3">
        ${s.ativo ? 
          `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 border border-emerald-800 text-emerald-300">ATIVO</span>` : 
          `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 border border-red-800 text-red-300">INATIVO</span>`}
      </td>
    </tr>
  `).join('');
}

function applyServidoresFilter(allServidores) {
  const busca = document.getElementById("filtro-srv-busca").value.toLowerCase();
  const cargo = document.getElementById("filtro-srv-cargo").value;
  const unidade = document.getElementById("filtro-srv-unidade").value;
  const status = document.getElementById("filtro-srv-status").value;
  const tpe = document.getElementById("filtro-srv-tpe") ? document.getElementById("filtro-srv-tpe").value : "";
  const miss = document.getElementById("filtro-srv-miss") ? document.getElementById("filtro-srv-miss").value : "";

  const filtered = allServidores.filter(s => {
    const matchBusca = !busca ||
      s.matricula.toLowerCase().includes(busca) ||
      s.nome_completo.toLowerCase().includes(busca) ||
      (s.nome_guerra && s.nome_guerra.toLowerCase().includes(busca)) ||
      s.email_institucional.toLowerCase().includes(busca);
    const matchCargo = !cargo || s.cargo_sigla === cargo;
    const matchUnidade = !unidade || s.unidade_sigla === unidade;
    const matchStatus = !status || String(s.ativo) === status;
    const matchTpe = !tpe || String(s.tpe) === tpe;
    const matchMiss = !miss || String(s.is_missionario_geral) === miss;
    return matchBusca && matchCargo && matchUnidade && matchStatus && matchTpe && matchMiss;
  });

  document.getElementById("servidores-tbody").innerHTML = renderServidoresRows(filtered);
}

async function openModalNovoServidor() {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContainer.classList.remove("hidden");

  const cargos = METADATA_CACHE.cargos.length ? METADATA_CACHE.cargos : await apiFetch("/api/missoes/meta/cargos");
  const unidades = METADATA_CACHE.unidades.length ? METADATA_CACHE.unidades : await apiFetch("/api/missoes/meta/unidades");

  modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 class="text-base font-bold text-white">Cadastrar Servidor da Polícia Federal</h2>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white">&times;</button>
      </div>

      <form id="form-criar-servidor" class="space-y-3 text-xs">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Matrícula Funcional</label>
            <input type="text" id="srv-matricula" required placeholder="Ex: 25489" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Nome Completo</label>
            <input type="text" id="srv-nome" required placeholder="NOME DO SERVIDOR" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold uppercase">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Nome de Guerra</label>
            <input type="text" id="srv-guerra" placeholder="GUERRA" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white uppercase">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Cargo / Carreira</label>
            <select id="srv-cargo" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              ${cargos.map(c => `<option value="${c.sigla}">${c.sigla} - ${c.descricao}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Unidade de Lotação (PB no topo)</label>
            <select id="srv-unidade" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              ${unidades.map(u => `<option value="${u.sigla}">${u.sigla} - ${u.nome_extenso}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">E-mail Institucional</label>
            <input type="email" id="srv-email" required placeholder="usuario.xyz@pf.gov.br" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Telefone Celular</label>
            <input type="text" id="srv-telefone" placeholder="(83) 99999-9999" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div class="flex items-center space-x-4 pt-4">
            <label class="flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" id="srv-tpe" class="rounded bg-slate-900 border-slate-700 text-pf-gold focus:ring-0">
              <span class="text-slate-300">Possui TPE (Instrutor/Docente)</span>
            </label>
            <label class="flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" id="srv-missionario" checked class="rounded bg-slate-900 border-slate-700 text-pf-gold focus:ring-0">
              <span class="text-slate-300">Gera Diárias em Viagem</span>
            </label>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-slate-800">
          <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold">Cancelar</button>
          <button type="submit" class="px-5 py-2 bg-pf-700 hover:bg-pf-600 text-white font-bold rounded-xl shadow">Salvar Servidor</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("form-criar-servidor").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      matricula: document.getElementById("srv-matricula").value.trim(),
      nome_completo: document.getElementById("srv-nome").value.trim().toUpperCase(),
      nome_guerra: document.getElementById("srv-guerra").value.trim().toUpperCase() || null,
      cargo_sigla: document.getElementById("srv-cargo").value,
      unidade_sigla: document.getElementById("srv-unidade").value,
      email_institucional: document.getElementById("srv-email").value.trim().toLowerCase(),
      telefone_celular: document.getElementById("srv-telefone").value.trim() || null,
      tpe: document.getElementById("srv-tpe").checked,
      is_missionario_geral: document.getElementById("srv-missionario").checked,
      ativo: true
    };

    try {
      await apiFetch("/api/servidores", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      closeModal();
      navigate("servidores");
    } catch (err) {
      alert(`Erro ao cadastrar servidor: ${err.message}`);
    }
  });
}

// ==============================================================================
// 5. SIMULADOR E CALCULADORA DE DIÁRIAS
// ==============================================================================
function renderDiariasCalculator(container) {
  const diariaBase = SYSTEM_CONFIG.valor_diaria_padrao || "425.00";
  container.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <h3 class="text-base font-bold text-white mb-1">Simulador de Diárias Oficiais da Polícia Federal</h3>
        <p class="text-xs text-slate-400 mb-6">Fórmula legal: <code class="bg-slate-900 px-2 py-1 rounded text-pf-gold font-mono font-bold">(dias - 0,5) × valor_diaria</code> com isenção total para lotação na sede da missão.</p>

        <div class="space-y-4 text-xs">
          <div>
            <label class="block text-slate-300 font-semibold mb-1">Quantidade de Dias Corridos de Missão</label>
            <input type="number" id="calc-dias" min="1" value="10" class="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-white font-bold focus:border-pf-gold">
          </div>

          <div>
            <label class="block text-slate-300 font-semibold mb-1">Valor Unitário da Diária Homologada (R$)</label>
            <input type="number" id="calc-valor" step="0.50" value="${diariaBase}" class="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-amber-300 font-extrabold focus:border-pf-gold">
          </div>

          <div class="bg-slate-900 p-3 rounded-xl border border-slate-800 flex items-center space-x-3">
            <input type="checkbox" id="calc-sede" class="w-4 h-4 rounded bg-slate-800 border-slate-700 text-pf-gold focus:ring-0">
            <div>
              <label for="calc-sede" class="font-bold text-white cursor-pointer">Efetivo Lotado na Sede da Missão</label>
              <p class="text-[11px] text-slate-400">Ex: Servidor de João Pessoa atuando na sede da SR/PF/PB.</p>
            </div>
          </div>

          <button onclick="executarCalculoSimulador()" class="w-full bg-gradient-to-r from-pf-gold to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-slate-950 font-bold py-3 rounded-xl uppercase tracking-wider shadow-lg transition">
            Calcular Diárias e Custo
          </button>
        </div>

        <div id="calc-resultado" class="mt-6 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
        </div>
      </div>
    </div>
  `;
  executarCalculoSimulador();
}

function executarCalculoSimulador() {
  const dias = parseInt(document.getElementById("calc-dias").value || 1);
  const valorUnit = parseFloat(document.getElementById("calc-valor").value || 0);
  const isSede = document.getElementById("calc-sede").checked;

  let qtdDiarias = 0.0;
  if (isSede) {
    qtdDiarias = 0.0;
  } else if (dias <= 1) {
    qtdDiarias = 0.5;
  } else {
    qtdDiarias = dias - 0.5;
  }

  const totalDiarias = isSede ? 0.0 : qtdDiarias * valorUnit;

  const resultBox = document.getElementById("calc-resultado");
  resultBox.innerHTML = `
    <div class="grid grid-cols-3 gap-4 text-center">
      <div class="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
        <p class="text-slate-500 uppercase font-semibold text-[10px]">Dias de Missão</p>
        <p class="text-xl font-bold text-white mt-1">${dias} dias</p>
      </div>
      <div class="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
        <p class="text-slate-500 uppercase font-semibold text-[10px]">Qtd Diárias Devidas</p>
        <p class="text-xl font-bold text-amber-300 mt-1">${qtdDiarias} diárias</p>
      </div>
      <div class="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
        <p class="text-slate-500 uppercase font-semibold text-[10px]">Valor Total Devido</p>
        <p class="text-xl font-extrabold text-emerald-400 mt-1">${formatMoney(totalDiarias)}</p>
      </div>
    </div>
    ${isSede ? `<p class="text-xs text-amber-300 bg-amber-950/40 p-2 rounded-lg border border-amber-800/60 text-center font-medium">Nota: Servidor lotado na localidade da missão não gera pagamento de diárias (Efetivo Orgânico Local).</p>` : ''}
  `;
}

// ==============================================================================
// 6. EXPORTAÇÃO DE DADOS
// ==============================================================================
function renderExportar(container) {
  container.innerHTML = `
    <div class="max-w-3xl mx-auto space-y-6 animate-fade-in">
      <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 space-y-6">
        <div>
          <h3 class="text-base font-bold text-white">Central de Exportação e Relatórios Oficiais</h3>
          <p class="text-xs text-slate-400 mt-1">Gere relatórios executivos e datasets com suporte a missões individuais e chefiadas.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 p-5 rounded-2xl flex flex-col justify-between transition">
            <div>
              <div class="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-700/50 flex items-center justify-center text-emerald-400 mb-3">
                <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm1 8h-4v2h4v-2zm-4 4h4v-2h-4v2zm-2-4H7v2h2v-2zm-2 4h2v-2H7v2zm8 4h-4v2h4v-2zm-4-6h4v-2h-4v2z"/></svg>
              </div>
              <h4 class="font-bold text-white text-sm">Planilha Excel (.xlsx)</h4>
              <p class="text-xs text-slate-400 mt-1">Relatório multiabas com modalidade, chefe e missionário.</p>
            </div>
            <a href="/api/export/missoes.xlsx" target="_blank" class="mt-4 w-full text-center py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition">
              Baixar .XLSX
            </a>
          </div>

          <div class="bg-slate-900 border border-slate-800 hover:border-blue-500/50 p-5 rounded-2xl flex flex-col justify-between transition">
            <div>
              <div class="w-10 h-10 rounded-xl bg-blue-950 border border-blue-700/50 flex items-center justify-center text-blue-400 mb-3">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </div>
              <h4 class="font-bold text-white text-sm">Arquivo CSV (.csv)</h4>
              <p class="text-xs text-slate-400 mt-1">Exportação UTF-8 com BOM para importação rápida em planilhas.</p>
            </div>
            <a href="/api/export/missoes.csv" target="_blank" class="mt-4 w-full text-center py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition">
              Baixar .CSV
            </a>
          </div>

          <div class="bg-slate-900 border border-slate-800 hover:border-amber-500/50 p-5 rounded-2xl flex flex-col justify-between transition">
            <div>
              <div class="w-10 h-10 rounded-xl bg-amber-950 border border-amber-700/50 flex items-center justify-center text-amber-400 mb-3">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
              </div>
              <h4 class="font-bold text-white text-sm">JSON Canônico</h4>
              <p class="text-xs text-slate-400 mt-1">Payload estruturado com metadados para auditoria e SEI/SCDP.</p>
            </div>
            <a href="/api/export/missoes.json" target="_blank" class="mt-4 w-full text-center py-2 bg-pf-gold hover:bg-yellow-400 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition">
              Baixar .JSON
            </a>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ==============================================================================
// 7. TRILHA DE AUDITORIA (HORÁRIO OFICIAL DO BRASIL BRT E DETALHES CLICÁVEIS)
// ==============================================================================
async function renderAuditoria(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando trilha de auditoria...</div>`;
  try {
    const logs = await apiFetch("/api/audit/logs");
    CURRENT_LOGS_CACHE = logs;
    window.__lastAuditLogs = logs;

    container.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-bold text-white uppercase tracking-wider">Trilha Imutável de Auditoria (Compliance e LGPD)</h3>
              <p class="text-xs text-slate-400">Horário Oficial de Brasília (BRT / UTC-3) • Clique em qualquer registro ou linha de logon para detalhes completos</p>
            </div>
            <span class="px-3 py-1 bg-pf-900 border border-pf-600/40 text-blue-300 rounded-xl text-xs font-mono">
              Fuso Horário: America/Sao_Paulo (BRT)
            </span>
          </div>

          <!-- Filtros de Auditoria -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs pt-2 border-t border-slate-800/80">
            <div>
              <input type="text" id="filtro-audit-busca" placeholder="Buscar por usuário, IP, entidade..."
                     class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pf-gold">
            </div>
            <div>
              <select id="filtro-audit-op" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300">
                <option value="">Todas as Operações</option>
                <option value="LOGIN">LOGIN (Logon com Sucesso)</option>
                <option value="LOGIN_FAILED">LOGIN_FAILED (Falha de Logon)</option>
                <option value="LOGIN_BLOCKED">LOGIN_BLOCKED (Conta Inativa)</option>
                <option value="CRIAR_MISSAO">CRIAR_MISSAO</option>
                <option value="STATUS_MISSAO">STATUS_MISSAO</option>
                <option value="ALTERAR_DIARIA_MISSAO">ALTERAR_DIARIA_MISSAO</option>
                <option value="ADICIONAR_PARTICIPANTE">ADICIONAR_PARTICIPANTE</option>
                <option value="REMOVER_PARTICIPANTE">REMOVER_PARTICIPANTE</option>
                <option value="CRIAR_SERVIDOR">CRIAR_SERVIDOR</option>
                <option value="CRIAR_USUARIO">CRIAR_USUARIO</option>
              </select>
            </div>
            <div>
              <input type="date" id="filtro-audit-data" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white" title="Filtrar por data específica">
            </div>
          </div>
        </div>

        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[10px]">
                <tr>
                  <th class="py-3 px-3">Data/Hora Oficial (BRT)</th>
                  <th class="py-3 px-3">Operador</th>
                  <th class="py-3 px-3">IP Origem</th>
                  <th class="py-3 px-3">Operação</th>
                  <th class="py-3 px-3">Entidade Afetada</th>
                  <th class="py-3 px-3">Resumo da Ação</th>
                  <th class="py-3 px-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60" id="auditoria-tbody">
                ${renderAuditoriaRows(logs)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Filtros
    const onAuditFilter = () => applyAuditoriaFilter(logs);
    document.getElementById("filtro-audit-busca").addEventListener("input", onAuditFilter);
    document.getElementById("filtro-audit-op").addEventListener("change", onAuditFilter);
    document.getElementById("filtro-audit-data").addEventListener("change", onAuditFilter);

  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao carregar auditoria: ${err.message}</div>`;
  }
}

function renderAuditoriaRows(logs) {
  if (logs.length === 0) {
    return `<tr><td colspan="7" class="text-center py-8 text-slate-500">Nenhum evento registrado.</td></tr>`;
  }
  return logs.map((l, idx) => `
    <tr class="hover:bg-slate-800/40 transition cursor-pointer" onclick="openAuditDetail(${idx})">
      <td class="py-3 px-3 font-mono text-emerald-400 whitespace-nowrap font-bold">${l.timestamp}</td>
      <td class="py-3 px-3 font-bold text-white font-mono">${l.usuario_login}</td>
      <td class="py-3 px-3 text-slate-400 font-mono">${l.usuario_ip}</td>
      <td class="py-3 px-3">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
          l.operacao === 'LOGIN' ? 'bg-emerald-950 border border-emerald-800 text-emerald-300' :
          (l.operacao === 'LOGIN_FAILED' || l.operacao === 'LOGIN_BLOCKED') ? 'bg-red-950 border border-red-800 text-red-300' :
          'bg-slate-800 border border-slate-700 text-blue-300'
        }">
          ${l.operacao}
        </span>
      </td>
      <td class="py-3 px-3 font-mono text-slate-300">${l.entidade_tabela} ${l.registro_id ? `(#${l.registro_id})` : ''}</td>
      <td class="py-3 px-3 font-mono text-[11px] text-slate-400 max-w-xs truncate">
        ${l.detalhes ? JSON.stringify(l.detalhes) : '-'}
      </td>
      <td class="py-3 px-3 text-right">
        <button class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-semibold text-[10px]">
          Ver Detalhes
        </button>
      </td>
    </tr>
  `).join('');
}

let CURRENT_LOGS_CACHE = [];
function applyAuditoriaFilter(allLogs) {
  CURRENT_LOGS_CACHE = allLogs;
  const busca = document.getElementById("filtro-audit-busca").value.toLowerCase();
  const op = document.getElementById("filtro-audit-op").value;
  const data = document.getElementById("filtro-audit-data").value;

  const filtered = allLogs.filter(l => {
    const matchBusca = !busca ||
      l.usuario_login.toLowerCase().includes(busca) ||
      l.usuario_ip.toLowerCase().includes(busca) ||
      l.entidade_tabela.toLowerCase().includes(busca) ||
      (l.detalhes && JSON.stringify(l.detalhes).toLowerCase().includes(busca));
    const matchOp = !op || l.operacao === op;
    const matchData = !data || (l.timestamp && l.timestamp.startsWith(data));
    return matchBusca && matchOp && matchData;
  });

  document.getElementById("auditoria-tbody").innerHTML = renderAuditoriaRows(filtered);
}

function openAuditDetail(logIndex) {
  const log = (CURRENT_LOGS_CACHE.length > 0 ? CURRENT_LOGS_CACHE : window.__lastAuditLogs || [])[logIndex];
  if (!log) return;

  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContainer.classList.remove("hidden");

  const isLogon = log.operacao === 'LOGIN' || log.operacao === 'LOGIN_FAILED' || log.operacao === 'LOGIN_BLOCKED';

  modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div>
          <span class="text-[10px] text-pf-gold font-bold uppercase tracking-wider">Trilha de Auditoria • Registro Forense</span>
          <h2 class="text-base font-bold text-white mt-0.5">Operação: ${log.operacao}</h2>
        </div>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white">&times;</button>
      </div>

      ${isLogon ? `
        <div class="p-4 rounded-xl border ${log.operacao === 'LOGIN' ? 'bg-emerald-950/40 border-emerald-800/80' : 'bg-red-950/40 border-red-800/80'}">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold uppercase tracking-wider ${log.operacao === 'LOGIN' ? 'text-emerald-300' : 'text-red-300'}">
              ${log.operacao === 'LOGIN' ? '✅ Sessão de Logon Autenticada com Sucesso' : '⚠️ Tentativa de Logon Rejeitada / Bloqueada'}
            </span>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-900 border border-slate-700 text-slate-300">
              BRT Oficial: ${log.timestamp}
            </span>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            <div><span class="text-slate-400">Usuário:</span> <strong class="text-white font-mono">${log.usuario_login}</strong></div>
            <div><span class="text-slate-400">Nome:</span> <span class="text-slate-200">${log.detalhes?.nome_completo || '-'}</span></div>
            <div><span class="text-slate-400">Perfil (RBAC):</span> <span class="text-pf-gold font-bold">${log.detalhes?.role || '-'}</span></div>
            <div><span class="text-slate-400">IP de Origem:</span> <span class="text-slate-200 font-mono">${log.usuario_ip}</span></div>
            <div class="col-span-2"><span class="text-slate-400">Navegador/Agente:</span> <span class="text-slate-300 font-mono text-[11px] truncate block">${log.detalhes?.user_agent || 'N/A'}</span></div>
          </div>
        </div>
      ` : ''}

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs">
        <div>
          <p class="text-slate-500 uppercase font-semibold text-[10px]">Horário Oficial (BRT - UTC-3)</p>
          <p class="font-bold text-emerald-400 font-mono mt-0.5">${log.timestamp}</p>
        </div>
        <div>
          <p class="text-slate-500 uppercase font-semibold text-[10px]">Operador Responsável</p>
          <p class="font-bold text-white font-mono mt-0.5">${log.usuario_login}</p>
        </div>
        <div>
          <p class="text-slate-500 uppercase font-semibold text-[10px]">Endereço IP Origem</p>
          <p class="font-mono text-slate-300 mt-0.5">${log.usuario_ip}</p>
        </div>
        <div>
          <p class="text-slate-500 uppercase font-semibold text-[10px]">Tabela / Registro</p>
          <p class="font-mono text-pf-gold font-bold mt-0.5">${log.entidade_tabela} (${log.registro_id || 'Global'})</p>
        </div>
      </div>

      <div>
        <h4 class="text-xs font-bold text-slate-300 uppercase mb-1">Carga de Dados / Detalhes Estruturados (JSON Payload):</h4>
        <pre class="bg-slate-950 p-4 rounded-xl text-emerald-400 font-mono text-xs overflow-x-auto max-h-80 border border-slate-800">${JSON.stringify(log.detalhes, null, 2)}</pre>
      </div>

      <div class="flex justify-end pt-2 border-t border-slate-800">
        <button onclick="closeModal()" class="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold">Fechar</button>
      </div>
    </div>
  `;
}

// ==============================================================================
// 8. GESTÃO DE USUÁRIOS E PERFIS RBAC (ADMIN ONLY)
// ==============================================================================
async function renderUsuarios(container) {
  if (!CURRENT_USER || CURRENT_USER.role !== "ADMIN") {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Acesso restrito ao perfil Administrador.</div>`;
    return;
  }

  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando usuários do sistema...</div>`;
  try {
    const usuarios = await apiFetch("/api/usuarios");

    container.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 class="text-sm font-bold text-white uppercase tracking-wider">Gestão de Usuários e Controle de Acesso (RBAC)</h3>
              <p class="text-xs text-slate-400">Administração de perfis: ADMIN, CADASTRADOR, GERENCIAL e SERVIDOR</p>
            </div>
            <button onclick="openModalNovoUsuario()" class="bg-pf-gold hover:bg-yellow-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow flex items-center space-x-1.5 transition">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
              <span>Novo Usuário</span>
            </button>
          </div>

          <!-- Filtros de Usuários -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs pt-2 border-t border-slate-800/80">
            <div>
              <input type="text" id="filtro-usr-busca" placeholder="Buscar por login, nome, e-mail..."
                     class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pf-gold">
            </div>
            <div>
              <select id="filtro-usr-role" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300">
                <option value="">Todos os Perfis (RBAC)</option>
                <option value="ADMIN">ADMIN</option>
                <option value="CADASTRADOR">CADASTRADOR</option>
                <option value="GERENCIAL">GERENCIAL</option>
                <option value="SERVIDOR">SERVIDOR</option>
              </select>
            </div>
            <div>
              <select id="filtro-usr-status" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300">
                <option value="">Todos os Status</option>
                <option value="true">Somente Ativos</option>
                <option value="false">Inativos</option>
              </select>
            </div>
          </div>
        </div>

        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[10px]">
                <tr>
                  <th class="py-3 px-3">Usuário / Matrícula</th>
                  <th class="py-3 px-3">Nome Completo</th>
                  <th class="py-3 px-3">E-mail Institucional</th>
                  <th class="py-3 px-3">Perfil RBAC</th>
                  <th class="py-3 px-3">Status</th>
                  <th class="py-3 px-3">Criado Em</th>
                  <th class="py-3 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60" id="usuarios-tbody">
                ${renderUsuariosRows(usuarios)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const onUsrFilter = () => applyUsuariosFilter(usuarios);
    document.getElementById("filtro-usr-busca").addEventListener("input", onUsrFilter);
    document.getElementById("filtro-usr-role").addEventListener("change", onUsrFilter);
    document.getElementById("filtro-usr-status").addEventListener("change", onUsrFilter);

  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao carregar usuários: ${err.message}</div>`;
  }
}

function renderUsuariosRows(usuarios) {
  if (usuarios.length === 0) {
    return `<tr><td colspan="7" class="text-center py-8 text-slate-500">Nenhum usuário encontrado.</td></tr>`;
  }
  return usuarios.map(u => `
    <tr class="hover:bg-slate-800/40 transition">
      <td class="py-3 px-3 font-mono font-bold text-pf-gold">${u.username}</td>
      <td class="py-3 px-3 font-semibold text-white">${u.full_name || '-'}</td>
      <td class="py-3 px-3 text-slate-300">${u.email || '-'}</td>
      <td class="py-3 px-3">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
          u.role === 'ADMIN' ? 'bg-red-950 border border-red-800 text-red-300' :
          u.role === 'CADASTRADOR' ? 'bg-amber-950 border border-amber-800 text-amber-300' :
          u.role === 'GERENCIAL' ? 'bg-blue-950 border border-blue-800 text-blue-300' :
          'bg-slate-800 border border-slate-700 text-slate-300'
        }">
          ${u.role}
        </span>
      </td>
      <td class="py-3 px-3">
        ${u.is_active ? 
          `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 border border-emerald-800 text-emerald-300">ATIVO</span>` : 
          `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 border border-red-800 text-red-300">INATIVO</span>`}
      </td>
      <td class="py-3 px-3 text-slate-400 font-mono text-[11px]">${formatDateBR(u.created_at)}</td>
      <td class="py-3 px-3 text-right space-x-1">
        <button onclick="openModalEditarUsuario(${JSON.stringify(u).replace(/"/g, '&quot;')})" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-semibold text-[11px] transition">
          Editar
        </button>
        <button onclick="openModalResetarSenha('${u.id}', '${u.username}')" class="px-2.5 py-1 bg-amber-900/60 hover:bg-amber-800 text-amber-200 rounded font-semibold text-[11px] transition">
          Senha
        </button>
        ${u.id !== CURRENT_USER.id ? `
          <button onclick="excluirUsuario('${u.id}', '${u.username}')" class="px-2.5 py-1 bg-red-900/60 hover:bg-red-800 text-red-200 rounded font-semibold text-[11px] transition">
            Excluir
          </button>
        ` : ''}
      </td>
    </tr>
  `).join('');
}

function applyUsuariosFilter(allUsuarios) {
  const busca = document.getElementById("filtro-usr-busca").value.toLowerCase();
  const role = document.getElementById("filtro-usr-role").value;
  const status = document.getElementById("filtro-usr-status").value;

  const filtered = allUsuarios.filter(u => {
    const matchBusca = !busca ||
      u.username.toLowerCase().includes(busca) ||
      (u.full_name && u.full_name.toLowerCase().includes(busca)) ||
      (u.email && u.email.toLowerCase().includes(busca));
    const matchRole = !role || u.role === role;
    const matchStatus = !status || String(u.is_active) === status;
    return matchBusca && matchRole && matchStatus;
  });

  document.getElementById("usuarios-tbody").innerHTML = renderUsuariosRows(filtered);
}

function openModalNovoUsuario() {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContainer.classList.remove("hidden");

  modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 class="text-base font-bold text-white">Cadastrar Novo Usuário do SIS-MISSÕES</h2>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white">&times;</button>
      </div>

      <form id="form-criar-usuario" class="space-y-3 text-xs">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Usuário / Login Funcional</label>
            <input type="text" id="usr-username" required placeholder="Ex: joao.silva" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Nome Completo</label>
            <input type="text" id="usr-nome" required placeholder="Nome Completo do Servidor" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">E-mail Institucional</label>
            <input type="email" id="usr-email" required placeholder="usuario@pf.gov.br" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Senha Provisória</label>
            <input type="password" id="usr-password" required placeholder="Mínimo 6 caracteres" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div class="md:col-span-2">
            <label class="block text-slate-400 mb-1">Perfil de Acesso (RBAC)</label>
            <select id="usr-role" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-bold">
              <option value="CADASTRADOR">CADASTRADOR - Pode cadastrar e editar missões, mas NÃO aprova nem emite OM</option>
              <option value="GERENCIAL">GERENCIAL - Apenas consulta todos os relatórios, dashboards e status</option>
              <option value="ADMIN">ADMIN - Acesso total administrativo, aprovações, emissão de OM e gestão</option>
              <option value="SERVIDOR">SERVIDOR - Visualização de escala individual</option>
            </select>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-slate-800">
          <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold">Cancelar</button>
          <button type="submit" class="px-5 py-2 bg-pf-gold hover:bg-yellow-400 text-slate-950 font-bold rounded-xl shadow">Criar Usuário</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("form-criar-usuario").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      username: document.getElementById("usr-username").value.trim(),
      full_name: document.getElementById("usr-nome").value.trim(),
      email: document.getElementById("usr-email").value.trim().toLowerCase(),
      password: document.getElementById("usr-password").value,
      role: document.getElementById("usr-role").value,
      is_active: true
    };

    try {
      await apiFetch("/api/usuarios", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      alert(`Usuário '${payload.username}' criado com sucesso!`);
      closeModal();
      navigate("usuarios");
    } catch (err) {
      alert(`Erro ao criar usuário: ${err.message}`);
    }
  });
}

function openModalEditarUsuario(u) {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContainer.classList.remove("hidden");

  modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 class="text-base font-bold text-white">Editar Usuário: ${u.username}</h2>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white">&times;</button>
      </div>

      <form id="form-editar-usuario" class="space-y-3 text-xs">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Nome Completo</label>
            <input type="text" id="edit-nome" value="${u.full_name || ''}" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">E-mail Institucional</label>
            <input type="email" id="edit-email" value="${u.email || ''}" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Perfil RBAC</label>
            <select id="edit-role" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-bold">
              <option value="ADMIN" ${u.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
              <option value="CADASTRADOR" ${u.role === 'CADASTRADOR' ? 'selected' : ''}>CADASTRADOR</option>
              <option value="GERENCIAL" ${u.role === 'GERENCIAL' ? 'selected' : ''}>GERENCIAL</option>
              <option value="SERVIDOR" ${u.role === 'SERVIDOR' ? 'selected' : ''}>SERVIDOR</option>
            </select>
          </div>
          <div class="flex items-center pt-5 space-x-2">
            <input type="checkbox" id="edit-ativo" ${u.is_active ? 'checked' : ''} class="rounded bg-slate-900 border-slate-700 text-pf-gold focus:ring-0">
            <label for="edit-ativo" class="text-slate-200 font-semibold cursor-pointer">Usuário Ativo no Sistema</label>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-slate-800">
          <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold">Cancelar</button>
          <button type="submit" class="px-5 py-2 bg-pf-700 hover:bg-pf-600 text-white font-bold rounded-xl shadow">Salvar Alterações</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("form-editar-usuario").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      full_name: document.getElementById("edit-nome").value.trim(),
      email: document.getElementById("edit-email").value.trim().toLowerCase(),
      role: document.getElementById("edit-role").value,
      is_active: document.getElementById("edit-ativo").checked
    };

    try {
      await apiFetch(`/api/usuarios/${u.id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      alert(`Dados do usuário '${u.username}' atualizados com sucesso!`);
      closeModal();
      navigate("usuarios");
    } catch (err) {
      alert(`Erro ao editar usuário: ${err.message}`);
    }
  });
}

function openModalResetarSenha(userId, username) {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContainer.classList.remove("hidden");

  modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 class="text-base font-bold text-white">Redefinir Senha do Usuário: ${username}</h2>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white">&times;</button>
      </div>

      <form id="form-reset-senha" class="space-y-3 text-xs">
        <div>
          <label class="block text-slate-400 mb-1">Nova Senha (Mínimo 6 caracteres)</label>
          <input type="password" id="reset-nova-senha" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-slate-800">
          <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold">Cancelar</button>
          <button type="submit" class="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl shadow">Redefinir Senha</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("form-reset-senha").addEventListener("submit", async (e) => {
    e.preventDefault();
    const novaSenha = document.getElementById("reset-nova-senha").value;

    try {
      await apiFetch(`/api/usuarios/${userId}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ new_password: novaSenha })
      });
      alert(`Senha do usuário '${username}' redefinida com sucesso!`);
      closeModal();
    } catch (err) {
      alert(`Erro ao redefinir senha: ${err.message}`);
    }
  });
}

async function excluirUsuario(userId, username) {
  if (!confirm(`Deseja realmente excluir ou desativar o usuário '${username}'?`)) return;
  try {
    await apiFetch(`/api/usuarios/${userId}`, { method: "DELETE" });
    alert(`Usuário '${username}' removido com sucesso.`);
    navigate("usuarios");
  } catch (err) {
    alert(`Erro ao excluir usuário: ${err.message}`);
  }
}

// ==============================================================================
// 8.5. CADASTRO E GESTÃO DE UNIDADES (SOLICITANTES E DESTINO)
// ==============================================================================
async function renderUnidades(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando unidades...</div>`;
  try {
    const unidades = await apiFetch("/api/missoes/meta/unidades?todas=true");
    const isAdmin = CURRENT_USER && CURRENT_USER.role === "ADMIN";

    container.innerHTML = `
      <div class="space-y-6 animate-fade-in">
        <!-- Header & Ações -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-950/80 border border-slate-800 rounded-2xl p-5 shadow-xl">
          <div>
            <div class="flex items-center space-x-2">
              <h2 class="text-base font-bold text-white">Unidades da Polícia Federal</h2>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 border border-amber-800 text-pf-gold">Prioridade PB Oficial</span>
            </div>
            <p class="text-xs text-slate-400 mt-1">Unidades Solicitantes e de Destino com priorização da Paraíba (SR/PF/PB, CGE/PF/PB, PAT/PF/PB)</p>
          </div>
          ${isAdmin ? `
            <button onclick="openModalNovaUnidade()" class="px-4 py-2 bg-pf-gold hover:bg-yellow-400 text-slate-950 font-bold rounded-xl text-xs transition shadow flex items-center justify-center space-x-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
              <span>Nova Unidade</span>
            </button>
          ` : ''}
        </div>

        <!-- Filtros -->
        <div class="bg-slate-950/80 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-wrap gap-3 items-center text-xs">
          <div class="flex-1 min-w-[200px]">
            <input type="text" id="filtro-unid-busca" placeholder="🔍 Buscar por sigla, nome ou município..." 
                   class="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-pf-gold">
          </div>
          <div>
            <select id="filtro-unid-uf" class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-300">
              <option value="">Todas as UFs</option>
              <option value="PB">PB (Paraíba)</option>
              <option value="DF">DF (Distrito Federal)</option>
              <option value="RJ">RJ (Rio de Janeiro)</option>
              <option value="SP">SP (São Paulo)</option>
              <option value="PR">PR (Paraná)</option>
              <option value="AM">AM (Amazonas)</option>
              <option value="BA">BA (Bahia)</option>
              <option value="CE">CE (Ceará)</option>
              <option value="PE">PE (Pernambuco)</option>
              <option value="RN">RN (Rio Grande do Norte)</option>
            </select>
          </div>
          <div>
            <select id="filtro-unid-status" class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-300">
              <option value="">Todos os Status</option>
              <option value="true" selected>Apenas Ativas</option>
              <option value="false">Apenas Inativas</option>
            </select>
          </div>
        </div>

        <!-- Tabela -->
        <div class="bg-slate-950/80 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <tr>
                  <th class="py-3 px-3">Sigla</th>
                  <th class="py-3 px-3">Nome Extenso</th>
                  <th class="py-3 px-3">Município / UF</th>
                  <th class="py-3 px-3">Fronteira</th>
                  <th class="py-3 px-3">Status</th>
                  <th class="py-3 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody id="unidades-tbody" class="divide-y divide-slate-800/60">
                ${renderUnidadesRows(unidades)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const triggerFilter = () => applyUnidadesFilter(unidades);
    document.getElementById("filtro-unid-busca")?.addEventListener("input", triggerFilter);
    document.getElementById("filtro-unid-uf")?.addEventListener("change", triggerFilter);
    document.getElementById("filtro-unid-status")?.addEventListener("change", triggerFilter);
    triggerFilter();
  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao carregar unidades: ${err.message}</div>`;
  }
}

function renderUnidadesRows(unidades) {
  if (!unidades || unidades.length === 0) {
    return `<tr><td colspan="6" class="py-8 text-center text-slate-400">Nenhuma unidade encontrada.</td></tr>`;
  }
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'ADMIN';
  const prioritarias = ['SR/PF/PB', 'CGE/PF/PB', 'PAT/PF/PB'];

  return unidades.map(u => {
    const isPB = prioritarias.includes(u.sigla);
    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-3 px-3 font-mono font-bold text-white flex items-center">
          <span class="text-pf-gold">${u.sigla}</span>
          ${isPB ? `<span class="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-pf-gold border border-amber-500/30">PRIORITÁRIA PB</span>` : ''}
        </td>
        <td class="py-3 px-3 font-semibold text-slate-200">${u.nome_extenso || '-'}</td>
        <td class="py-3 px-3 text-slate-300">${u.municipio || '-'} / <span class="font-bold text-slate-400">${u.uf || '-'}</span></td>
        <td class="py-3 px-3">
          ${u.is_fronteira ? 
            `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 border border-purple-800 text-purple-300">FRONTEIRA</span>` : 
            `<span class="text-slate-500 text-[11px]">-</span>`}
        </td>
        <td class="py-3 px-3">
          ${u.ativo ? 
            `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 border border-emerald-800 text-emerald-300">ATIVA</span>` : 
            `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 border border-red-800 text-red-300">INATIVA</span>`}
        </td>
        <td class="py-3 px-3 text-right space-x-1">
          ${isAdmin ? `
            <button onclick="openModalEditarUnidade(${JSON.stringify(u).replace(/"/g, '&quot;')})" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-semibold text-[11px] transition">
              Editar
            </button>
            ${u.ativo ? `
              <button onclick="desativarUnidade('${u.id}', '${u.sigla}')" class="px-2.5 py-1 bg-red-900/60 hover:bg-red-800 text-red-200 rounded font-semibold text-[11px] transition">
                Desativar
              </button>
            ` : `
              <button onclick="reativarUnidade('${u.id}', '${u.sigla}')" class="px-2.5 py-1 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 rounded font-semibold text-[11px] transition">
                Reativar
              </button>
            `}
          ` : `
            <span class="text-slate-500 text-[11px]">Somente Leitura</span>
          `}
        </td>
      </tr>
    `;
  }).join('');
}

function applyUnidadesFilter(allUnidades) {
  const busca = document.getElementById("filtro-unid-busca")?.value.toLowerCase() || "";
  const uf = document.getElementById("filtro-unid-uf")?.value || "";
  const status = document.getElementById("filtro-unid-status")?.value || "";

  const filtered = allUnidades.filter(u => {
    const matchBusca = !busca ||
      u.sigla.toLowerCase().includes(busca) ||
      (u.nome_extenso && u.nome_extenso.toLowerCase().includes(busca)) ||
      (u.municipio && u.municipio.toLowerCase().includes(busca));
    const matchUf = !uf || u.uf === uf;
    const matchStatus = !status || String(Boolean(u.ativo)) === status;
    return matchBusca && matchUf && matchStatus;
  });

  const tbody = document.getElementById("unidades-tbody");
  if (tbody) {
    tbody.innerHTML = renderUnidadesRows(filtered);
  }
}

function openModalNovaUnidade() {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContainer.classList.remove("hidden");

  modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 class="text-base font-bold text-white">Cadastrar Nova Unidade da PF</h2>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white">&times;</button>
      </div>

      <form id="form-criar-unidade" class="space-y-3 text-xs">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Sigla Oficial da Unidade</label>
            <input type="text" id="unid-sigla" required placeholder="Ex: DPF/JPA/PB" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono uppercase">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">UF (Estado)</label>
            <input type="text" id="unid-uf" required maxlength="2" placeholder="Ex: PB" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono uppercase">
          </div>
          <div class="md:col-span-2">
            <label class="block text-slate-400 mb-1">Nome Extenso Institucional</label>
            <input type="text" id="unid-nome" required placeholder="Ex: Delegacia de Polícia Federal em João Pessoa" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div class="md:col-span-2">
            <label class="block text-slate-400 mb-1">Município Sede</label>
            <input type="text" id="unid-municipio" required placeholder="Ex: João Pessoa" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div class="flex items-center space-x-2 pt-2">
            <input type="checkbox" id="unid-fronteira" class="rounded bg-slate-900 border-slate-700 text-pf-gold focus:ring-0">
            <label for="unid-fronteira" class="text-slate-200 font-semibold cursor-pointer">Unidade Localizada em Fronteira</label>
          </div>
          <div class="flex items-center space-x-2 pt-2">
            <input type="checkbox" id="unid-ativo" checked class="rounded bg-slate-900 border-slate-700 text-pf-gold focus:ring-0">
            <label for="unid-ativo" class="text-slate-200 font-semibold cursor-pointer">Unidade Ativa no Sistema</label>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-slate-800">
          <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold">Cancelar</button>
          <button type="submit" class="px-5 py-2 bg-pf-gold hover:bg-yellow-400 text-slate-950 font-bold rounded-xl shadow">Cadastrar Unidade</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("form-criar-unidade").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      sigla: document.getElementById("unid-sigla").value.trim().toUpperCase(),
      nome_extenso: document.getElementById("unid-nome").value.trim(),
      municipio: document.getElementById("unid-municipio").value.trim(),
      uf: document.getElementById("unid-uf").value.trim().toUpperCase(),
      is_fronteira: document.getElementById("unid-fronteira").checked,
      ativo: document.getElementById("unid-ativo").checked
    };

    try {
      await apiFetch("/api/missoes/meta/unidades", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      alert(`Unidade '${payload.sigla}' cadastrada com sucesso!`);
      closeModal();
      METADATA_CACHE.unidades = await apiFetch("/api/missoes/meta/unidades");
      navigate("unidades");
    } catch (err) {
      alert(`Erro ao cadastrar unidade: ${err.message}`);
    }
  });
}

function openModalEditarUnidade(u) {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContainer.classList.remove("hidden");

  modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 class="text-base font-bold text-white">Editar Unidade: ${u.sigla}</h2>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white">&times;</button>
      </div>

      <form id="form-editar-unidade" class="space-y-3 text-xs">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="md:col-span-2">
            <label class="block text-slate-400 mb-1">Nome Extenso Institucional</label>
            <input type="text" id="edit-unid-nome" value="${u.nome_extenso || ''}" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Município Sede</label>
            <input type="text" id="edit-unid-municipio" value="${u.municipio || ''}" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">UF (Estado)</label>
            <input type="text" id="edit-unid-uf" value="${u.uf || ''}" required maxlength="2" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono uppercase">
          </div>
          <div class="flex items-center space-x-2 pt-2">
            <input type="checkbox" id="edit-unid-fronteira" ${u.is_fronteira ? 'checked' : ''} class="rounded bg-slate-900 border-slate-700 text-pf-gold focus:ring-0">
            <label for="edit-unid-fronteira" class="text-slate-200 font-semibold cursor-pointer">Unidade Localizada em Fronteira</label>
          </div>
          <div class="flex items-center space-x-2 pt-2">
            <input type="checkbox" id="edit-unid-ativo" ${u.ativo ? 'checked' : ''} class="rounded bg-slate-900 border-slate-700 text-pf-gold focus:ring-0">
            <label for="edit-unid-ativo" class="text-slate-200 font-semibold cursor-pointer">Unidade Ativa no Sistema</label>
          </div>
        </div>

        <div class="flex justify-end space-x-2 pt-3 border-t border-slate-800">
          <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold">Cancelar</button>
          <button type="submit" class="px-5 py-2 bg-pf-700 hover:bg-pf-600 text-white font-bold rounded-xl shadow">Salvar Alterações</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById("form-editar-unidade").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      nome_extenso: document.getElementById("edit-unid-nome").value.trim(),
      municipio: document.getElementById("edit-unid-municipio").value.trim(),
      uf: document.getElementById("edit-unid-uf").value.trim().toUpperCase(),
      is_fronteira: document.getElementById("edit-unid-fronteira").checked,
      ativo: document.getElementById("edit-unid-ativo").checked
    };

    try {
      await apiFetch(`/api/missoes/meta/unidades/${u.id}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      alert(`Unidade '${u.sigla}' atualizada com sucesso!`);
      closeModal();
      METADATA_CACHE.unidades = await apiFetch("/api/missoes/meta/unidades");
      navigate("unidades");
    } catch (err) {
      alert(`Erro ao editar unidade: ${err.message}`);
    }
  });
}

async function desativarUnidade(unidId, sigla) {
  if (!confirm(`Deseja realmente desativar a unidade '${sigla}'? As missões históricas permanecerão associadas.`)) return;
  try {
    await apiFetch(`/api/missoes/meta/unidades/${unidId}`, { method: "DELETE" });
    alert(`Unidade '${sigla}' desativada com sucesso.`);
    METADATA_CACHE.unidades = await apiFetch("/api/missoes/meta/unidades");
    navigate("unidades");
  } catch (err) {
    alert(`Erro ao desativar unidade: ${err.message}`);
  }
}

async function reativarUnidade(unidId, sigla) {
  try {
    await apiFetch(`/api/missoes/meta/unidades/${unidId}`, {
      method: "PUT",
      body: JSON.stringify({ ativo: true })
    });
    alert(`Unidade '${sigla}' reativada com sucesso!`);
    METADATA_CACHE.unidades = await apiFetch("/api/missoes/meta/unidades");
    navigate("unidades");
  } catch (err) {
    alert(`Erro ao reativar unidade: ${err.message}`);
  }
}

// ==============================================================================
// 9. PARÂMETROS GERAIS DO SISTEMA
// ==============================================================================
async function renderConfig(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando parâmetros...</div>`;
  try {
    const configs = await apiFetch("/api/config");
    container.innerHTML = `
      <div class="max-w-2xl mx-auto space-y-6 animate-fade-in">
        <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h3 class="text-base font-bold text-white mb-1">Parâmetros Gerais da Plataforma</h3>
          <p class="text-xs text-slate-400 mb-6">Valores de diária base e parâmetros de alertas corporativos</p>

          <div class="space-y-4 text-xs">
            ${configs.map(c => `
              <div class="bg-slate-900 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
                <div class="space-y-0.5 pr-4">
                  <p class="font-bold text-white font-mono">${c.chave}</p>
                  <p class="text-slate-400 text-[11px]">${c.descricao || ''}</p>
                </div>
                <div class="flex items-center space-x-2">
                  <input type="text" id="cfg-val-${c.chave}" value="${c.valor}"
                         class="w-32 bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono font-bold text-center">
                  <button onclick="salvarConfigItem('${c.chave}')"
                          class="px-3 py-1.5 bg-pf-700 hover:bg-pf-600 text-white rounded-lg font-bold text-[11px] transition">
                    Salvar
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao carregar configurações: ${err.message}</div>`;
  }
}

async function salvarConfigItem(chave) {
  const input = document.getElementById(`cfg-val-${chave}`);
  const valor = input.value.trim();
  try {
    await apiFetch(`/api/config/${chave}`, {
      method: "PUT",
      body: JSON.stringify({ valor })
    });
    alert(`Parâmetro '${chave}' atualizado com sucesso para: ${valor}`);
    await loadSystemConfig();
    navigate("config");
  } catch (err) {
    alert(`Erro ao salvar parâmetro: ${err.message}`);
  }
}
