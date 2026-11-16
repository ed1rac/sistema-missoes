/**
 * Sistema de Controle de Diárias e Passagens - Frontend Application
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
  modalidade: "INDIVIDUAL",
  tipo: "",
  unidade: "",
  cargo: "",
  setor: "",
  meio_transporte: "",
  unidade_pb: "",
  data_de: "",
  data_ate: ""
};
let MISSOES_FILTERS = {
  busca: "",
  status: "",
  modalidade: "INDIVIDUAL",
  ano: "",
  mes: ""
};
let CHART_INSTANCES = {};
let ACTIVE_SERVERS_MODAL = [];
let METADATA_CACHE = {
  tipos: [],
  unidades: [],
  cargos: [],
  papeis: [],
  setores: [],
  valoresDiarias: []
};

// Lista ÚNICA de Status Oficiais (idêntica entre Cadastro, Alteração de Status e Filtros)
const OFFICIAL_STATUSES = [
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
  "Concluído"
];

const APPROVAL_RESTRICTED_STATUS_KEYS = new Set([
  "APROVADA",
  "OM EMITIDA",
  "PCDP TRAMITADA",
  "PCDP CADASTRADA",
  "PCDP ENCAMINHADA",
  "PCDP PRESTAR CONTAS",
  "PRESTACAO CONTAS",
  "CONCLUIDA",
  "CONCLUIDO",
  "REJEITADA",
  "SAT ATENDIDA",
  "SAT RECUSADA"
]);

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

  let response;
  try {
    response = await fetch(`${API_BASE}${url}`, { ...options, headers });
  } catch (networkErr) {
    throw new Error("Falha de conexão com o servidor (Failed to fetch). Verifique se o serviço está ativo e tente novamente.");
  }

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

function renderApiErrorBox(titulo, err, retryCallbackStr) {
  const msg = escapeHtml(err?.message || "Erro desconhecido de comunicação com o servidor.");
  return `
    <div class="p-6 bg-red-950/60 border border-red-800 rounded-2xl text-red-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
      <div>
        <p class="font-bold text-sm text-red-100">⚠️ ${escapeHtml(titulo)}</p>
        <p class="mt-1 text-red-200/90">${msg}</p>
      </div>
      ${retryCallbackStr ? `
        <button type="button" onclick="${retryCallbackStr}" class="shrink-0 px-4 py-2 bg-red-800 hover:bg-red-700 text-white font-bold rounded-xl text-xs transition shadow">
          🔄 Tentar Novamente
        </button>
      ` : ""}
    </div>
  `;
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

function normalizeTextKey(val) {
  if (!val) return "";
  return String(val)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[_\/-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normStatusKey(status) {
  const k = normalizeTextKey(status);
  if (!k) return "";
  if (k === "CONCLUIDA" || k === "CONCLUIDO") return "CONCLUIDO";
  if (k === "PRESTACAO CONTAS") return "PCDP PRESTAR CONTAS";
  return k;
}

function formatStatusLabel(status) {
  if (!status) return "-";
  const k = normStatusKey(status);
  const oficial = OFFICIAL_STATUSES.find(st => normStatusKey(st) === k);
  return oficial || status;
}

function renderOfficialStatusOptions(selectedVal = "", emptyLabel = "Todos os Status", restrictForCadastrador = false) {
  const normSel = normStatusKey(selectedVal);
  const isCadastrador = restrictForCadastrador && CURRENT_USER && CURRENT_USER.role === "CADASTRADOR";
  return `
    ${emptyLabel ? `<option value="">${emptyLabel}</option>` : ""}
    ${OFFICIAL_STATUSES.map(st => {
      const k = normStatusKey(st);
      const sel = normSel && normSel === k ? "selected" : "";
      const isRestricted = isCadastrador && APPROVAL_RESTRICTED_STATUS_KEYS.has(k);
      const disabledAttr = (isRestricted && !sel) ? "disabled" : "";
      const label = isRestricted ? `${st} (Restrito)` : st;
      return `<option value="${st}" ${sel} ${disabledAttr}>${label}</option>`;
    }).join("")}
  `;
}

function normalizeDeslocamentoCode(raw) {
  const k = normalizeTextKey(raw);
  if (!k || k === "NAO DEFINIDO") return "NAO_DEFINIDO";
  if (k === "AEREO") return "AEREO";
  if (k === "PROPRIO") return "PROPRIO";
  if (k === "TERRESTRE" || k === "VIATURA OFICIAL") return "TERRESTRE";
  return String(raw || "NAO_DEFINIDO").trim().toUpperCase();
}

function renderDeslocamentoOptions(selectedVal = "NAO_DEFINIDO") {
  const norm = normalizeDeslocamentoCode(selectedVal);
  const opts = [
    { val: "NAO_DEFINIDO", label: "NÃO DEFINIDO" },
    { val: "AEREO", label: "AÉREO" },
    { val: "TERRESTRE", label: "TERRESTRE" },
    { val: "PROPRIO", label: "PRÓPRIO" }
  ];
  return opts.map(o => `<option value="${o.val}" ${norm === o.val ? "selected" : ""}>${o.label}</option>`).join("");
}

function formatTransporteText(meio) {
  const norm = normalizeDeslocamentoCode(meio);
  if (norm === "AEREO") return "✈️ Aéreo";
  if (norm === "PROPRIO") return "🚙 Próprio";
  if (norm === "TERRESTRE") return "🚗 Terrestre";
  return "❔ Não Definido";
}

function formatTransporteBadge(meio) {
  const norm = normalizeDeslocamentoCode(meio);
  if (norm === "AEREO") {
    return `<span class="bg-sky-950 border border-sky-800 text-sky-300 px-2 py-0.5 rounded text-[10px] font-bold">✈️ Aéreo</span>`;
  }
  if (norm === "PROPRIO") {
    return `<span class="bg-purple-950 border border-purple-800 text-purple-300 px-2 py-0.5 rounded text-[10px] font-bold">🚙 Próprio</span>`;
  }
  if (norm === "TERRESTRE") {
    return `<span class="bg-emerald-950 border border-emerald-800 text-emerald-300 px-2 py-0.5 rounded text-[10px] font-bold">🚗 Terrestre</span>`;
  }
  return `<span class="bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded text-[10px] font-bold">❔ Não Definido</span>`;
}

function calcDiasEDiariasPreview(dtInicioStr, dtFimStr, isSede = false) {
  if (!dtInicioStr || !dtFimStr) return { dias: 0, qtdDiarias: 0.0, valido: false };
  const d1 = new Date(`${dtInicioStr.slice(0, 10)}T00:00:00`);
  const d2 = new Date(`${dtFimStr.slice(0, 10)}T00:00:00`);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime()) || d2 < d1) {
    return { dias: 0, qtdDiarias: 0.0, valido: false };
  }
  const dias = Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
  let qtdDiarias = 0.0;
  if (isSede) qtdDiarias = 0.0;
  else if (dias <= 1) qtdDiarias = 0.5;
  else qtdDiarias = Math.round((dias - 0.5) * 10) / 10;
  return { dias, qtdDiarias, valido: true };
}

function getStatusBadgeClass(status) {
  if (!status) return "badge-INDICADO";
  const norm = normStatusKey(status).replace(/\s+/g, "_");
  return `badge-${norm}`;
}

function formatServidorOptionText(s) {
  if (!s) return "";
  const guerra = (s.nome_guerra || "").trim();
  const nome = (s.nome_completo || "").trim();
  const rotulo = guerra && nome ? `${guerra} — ${nome}` : (guerra || nome || s.matricula || "");
  return `[${s.cargo_sigla || "-"}] ${rotulo} (${s.unidade_sigla || "-"}) - Mat. ${s.matricula || "-"}`;
}

function formatServidorDisplayHtml(nomeGuerra, nomeCompleto, matricula = "") {
  const guerra = (nomeGuerra || "").trim();
  const nome = (nomeCompleto || "").trim();
  if (!guerra && !nome) return matricula ? `<span class="font-mono text-slate-300">${matricula}</span>` : "-";
  if (guerra && nome) {
    return `<span class="font-bold text-amber-300">${guerra}</span> <span class="text-slate-300 font-normal">(${nome})</span>`;
  }
  return `<span class="font-semibold text-white">${guerra || nome}</span>`;
}

function servidorMatchesTerm(s, rawTerm) {
  const term = normalizeTextKey(rawTerm);
  if (!term) return true;
  const hay = normalizeTextKey(
    `${s.nome_guerra || ""} ${s.nome_completo || ""} ${s.matricula || ""} ${s.cargo_sigla || ""} ${s.unidade_sigla || ""}`
  );
  return hay.includes(term);
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

  const role = CURRENT_USER.role;

  // Controle de visibilidade de menus por RBAC
  const navUsuarios = document.getElementById("nav-usuarios");
  if (navUsuarios) {
    navUsuarios.classList.toggle("hidden", role !== "ADMIN");
  }

  const navAuditoria = document.getElementById("nav-auditoria");
  if (navAuditoria) {
    navAuditoria.classList.toggle("hidden", !["ADMIN", "GESTOR_NAC", "GERENCIAL"].includes(role));
  }

  const navConfig = document.getElementById("nav-config");
  if (navConfig) {
    navConfig.classList.toggle("hidden", !["ADMIN", "GESTOR_NAC"].includes(role));
  }
}

async function loadSystemConfig() {
  try {
    const configs = await apiFetch("/api/config");
    configs.forEach(c => {
      SYSTEM_CONFIG[c.chave] = c.valor;
    });
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
    missoes: "GESTÃO RECRUTAMENTO",
    custos: "Custos por Missão e Servidor / Missionário",
    servidores: "Cadastro Integrado de Servidores da PF",
    "diarias-calc": "Simulador Oficial de Diárias (Legislação PF)",
    exportar: "Módulo de Interoperabilidade e Exportação",
    auditoria: "Trilha Imutável de Auditoria (Compliance)",
    usuarios: "Administração de Usuários e Perfis RBAC",
    unidades: "Cadastro de Unidades Solicitantes & Destino (PF)",
    config: "Parâmetros Gerais do Sistema e Diária Base"
  };
  document.getElementById("page-title").textContent = titles[viewName] || "Sistema de Controle de Diárias e Passagens";

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
                <option value="NAO_DEFINIDO" ${DASHBOARD_FILTERS.meio_transporte === 'NAO_DEFINIDO' ? 'selected' : ''}>❔ Não Definido</option>
                <option value="AEREO" ${DASHBOARD_FILTERS.meio_transporte === 'AEREO' ? 'selected' : ''}>✈️ Aéreo (Passagem Comercial)</option>
                <option value="TERRESTRE" ${DASHBOARD_FILTERS.meio_transporte === 'TERRESTRE' ? 'selected' : ''}>🚗 Terrestre / Viatura Oficial</option>
                <option value="PROPRIO" ${DASHBOARD_FILTERS.meio_transporte === 'PROPRIO' ? 'selected' : ''}>🚙 Veículo Próprio</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Status da Missão</label>
              <select id="dash-filtro-status" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-medium">
                ${renderOfficialStatusOptions(DASHBOARD_FILTERS.status, "Todos os Status")}
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Modalidade</label>
              <select id="dash-filtro-modalidade" onchange="aplicarFiltrosDashboard()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="INDIVIDUAL" ${DASHBOARD_FILTERS.modalidade === 'INDIVIDUAL' ? 'selected' : ''}>Individual (Padrão)</option>
                <option value="EQUIPE" ${DASHBOARD_FILTERS.modalidade === 'EQUIPE' ? 'selected' : ''}>Equipe Policial</option>
                <option value="" ${!DASHBOARD_FILTERS.modalidade ? 'selected' : ''}>Todas as Modalidades</option>
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
            <div onclick="filtrarPorStatusRapido('CADASTRAR_SCDP')"
                 class="cursor-pointer bg-slate-900 hover:bg-slate-850 p-4 rounded-xl border border-blue-900/60 hover:border-blue-500 transition shadow">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase text-blue-400">Cadastrar SCDP</span>
                <span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
              </div>
              <p class="text-2xl font-black text-white mt-1">${summary.servidores_cadastrar_scdp ?? summary.servidores_status_scdp ?? 0} <span class="text-xs font-normal text-slate-400">servidores</span></p>
              <p class="text-[10px] text-slate-400 mt-1">OM Emitida • Pendente SCDP/PCDP</p>
            </div>

            <!-- 2. Prestação Contas Pendente -->
            <div onclick="filtrarPorStatusRapido('PRESTACAO_CONTAS_PENDENTE')"
                 class="cursor-pointer bg-slate-900 hover:bg-slate-850 p-4 rounded-xl border border-orange-900/60 hover:border-orange-500 transition shadow">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase text-orange-400">Prestação Contas Pendente</span>
                <span class="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
              </div>
              <p class="text-2xl font-black text-white mt-1">${summary.servidores_prestacao_contas_pendente ?? summary.servidores_status_prestacao_contas ?? 0} <span class="text-xs font-normal text-slate-400">servidores</span></p>
              <p class="text-[10px] text-slate-400 mt-1">Retorno de Missão • Prestar Contas</p>
            </div>

            <!-- 3. OM Pendente -->
            <div onclick="filtrarPorStatusRapido('OM_PENDENTE')"
                 class="cursor-pointer bg-slate-900 hover:bg-slate-850 p-4 rounded-xl border border-amber-900/60 hover:border-amber-500 transition shadow">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase text-amber-400">OM Pendente</span>
                <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              </div>
              <p class="text-2xl font-black text-white mt-1">${summary.servidores_om_pendente ?? summary.servidores_status_om_pendente ?? 0} <span class="text-xs font-normal text-slate-400">servidores</span></p>
              <p class="text-[10px] text-slate-400 mt-1">SAT Atendida • Aguardando Emissão OM</p>
            </div>

            <!-- 4. Missão Concluída -->
            <div onclick="filtrarPorStatusRapido('CONCLUIDA')"
                 class="cursor-pointer bg-slate-900 hover:bg-slate-850 p-4 rounded-xl border border-emerald-900/60 hover:border-emerald-500 transition shadow">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold uppercase text-emerald-400">Missão Concluída</span>
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              </div>
              <p class="text-2xl font-black text-white mt-1">${summary.servidores_missao_concluida ?? summary.servidores_status_concluida ?? 0} <span class="text-xs font-normal text-slate-400">servidores</span></p>
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
    container.innerHTML = renderApiErrorBox("Erro ao carregar painel", err, "navigate('dashboard')");
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
    modalidade: "INDIVIDUAL",
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
  if (typeof Chart === "undefined") {
    console.warn("Chart.js não carregado; gráficos desabilitados no modo offline.");
    return;
  }
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
      const data = chartsData.passagens_por_unidade.map(u => (u.total_passagens !== undefined ? u.total_passagens : (u.passagens || 0)));

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
      const data = chartsData.passagens_por_setor.map(s => (s.total_passagens !== undefined ? s.total_passagens : (s.passagens || 0)));

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
              <th class="py-2.5 px-3">Modalidade</th>
              <th class="py-2.5 px-3">Missão / Policial</th>
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
                <td class="py-3 px-3">
                  <span class="badge-status badge-${m.modalidade || 'EQUIPE'}">${m.modalidade || 'EQUIPE'}</span>
                </td>
                <td class="py-3 px-3 font-medium text-white max-w-xs">
                  <p class="truncate font-semibold">${m.titulo}</p>
                  ${m.modalidade === 'INDIVIDUAL' && (m.missionario_nome || m.missionario_nome_guerra) ? `
                    <div class="text-[11px] truncate">${formatServidorDisplayHtml(m.missionario_nome_guerra, m.missionario_nome, m.missionario_matricula)}</div>
                  ` : (m.modalidade !== 'INDIVIDUAL' && (m.responsavel_nome || m.responsavel_nome_guerra) ? `
                    <div class="text-[11px] truncate">Chefe: ${formatServidorDisplayHtml(m.responsavel_nome_guerra, m.responsavel_nome, m.responsavel_matricula)}</div>
                  ` : '')}
                  <div class="text-[10px] text-slate-400 truncate">${m.unidade_solicitante} &rarr; ${m.unidade_destino || m.localidade_descricao}</div>
                </td>
                <td class="py-3 px-3 text-slate-400 whitespace-nowrap">${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)} (${m.total_dias}d)</td>
                <td class="py-3 px-3">
                  <span class="badge-status ${getStatusBadgeClass(m.status_atual)} text-[10px]">${formatStatusLabel(m.status_atual)}</span>
                </td>
                <td class="py-3 px-3 font-semibold text-amber-300">${formatMoney(m.valor_diaria_padrao)}</td>
                <td class="py-3 px-3 text-slate-300">${m.total_participantes} policiais</td>
                <td class="py-3 px-3 font-bold text-emerald-400">${formatMoney(m.total_custo_geral)}</td>
                <td class="py-3 px-3 text-right">
                  <button onclick="openMissaoDetail('${m.id}')" class="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-semibold transition">
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
          const missCol = missoes.filter(m => col.statusList.some(st => normStatusKey(st) === normStatusKey(m.status_atual)));
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
                      <span class="badge-status ${getStatusBadgeClass(m.status_atual)} text-[9px]">${formatStatusLabel(m.status_atual)}</span>
                      <span class="badge-status badge-${m.modalidade || 'EQUIPE'} text-[9px]">${m.modalidade || 'EQUIPE'}</span>
                    </div>

                    <h5 class="text-xs font-bold text-white line-clamp-2">${m.titulo}</h5>
                    ${m.modalidade === 'INDIVIDUAL' && (m.missionario_nome || m.missionario_nome_guerra) ? `
                      <p class="text-[11px] truncate">${formatServidorDisplayHtml(m.missionario_nome_guerra, m.missionario_nome, m.missionario_matricula)}</p>
                    ` : (m.modalidade !== 'INDIVIDUAL' && (m.responsavel_nome || m.responsavel_nome_guerra) ? `
                      <p class="text-[11px] truncate">Chefe: ${formatServidorDisplayHtml(m.responsavel_nome_guerra, m.responsavel_nome, m.responsavel_matricula)}</p>
                    ` : '')}
                    <p class="text-[10px] text-slate-400">${m.unidade_solicitante} &rarr; ${m.unidade_destino || m.localidade_descricao}</p>
                    
                    <div class="text-[10px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800">
                      <span>${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)}</span>
                      <span class="font-semibold text-white">${m.total_participantes} pol.</span>
                    </div>

                    <div class="flex items-center justify-between pt-1">
                      <span class="text-xs font-extrabold text-emerald-400">${formatMoney(m.total_custo_geral)}</span>
                      <button onclick="openMissaoDetail('${m.id}')" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded text-[10px] font-semibold transition">
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
// 2. GESTÃO RECRUTAMENTO (LISTAGEM ENXUTA + FILTROS HOT)
// ==============================================================================
async function renderMissoes(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando recrutamentos...</div>`;
  try {
    const missoes = await apiFetch("/api/missoes");
    window.LAST_MISSOES_LIST = missoes;

    const podeCriar = CURRENT_USER && (CURRENT_USER.role === "ADMIN" || CURRENT_USER.role === "GESTOR_NAC" || CURRENT_USER.role === "CADASTRADOR");

    container.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <!-- Action / Filter Bar -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-bold text-white uppercase tracking-wider">GESTÃO RECRUTAMENTO</h3>
              <p class="text-xs text-slate-400">Recrutamentos Individuais (Padrão) e Missões em Equipe • DPF/PB</p>
            </div>
            ${podeCriar ? `
              <button onclick="openModalNovaMissao()" class="bg-gradient-to-r from-pf-gold to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow-lg flex items-center space-x-2 transition">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                <span>Novo Recrutamento</span>
              </button>
            ` : `
              <span class="px-3 py-1 bg-slate-800 text-slate-400 text-xs rounded-xl font-semibold border border-slate-700">
                🔒 Perfil ${CURRENT_USER?.role || 'GERENCIAL'} (Somente Leitura)
              </span>
            `}
          </div>

          <!-- Filtros Rápidos HOT -->
          <div class="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs pt-2 border-t border-slate-800/80">
            <div class="md:col-span-2">
              <input type="text" id="filtro-busca" value="${escapeHtml(MISSOES_FILTERS.busca || '')}" placeholder="Buscar por nome, matrícula, cidade, unidade, OM, PCDP..."
                     class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-pf-gold">
            </div>

            <div>
              <select id="filtro-status" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none">
                ${renderOfficialStatusOptions(MISSOES_FILTERS.status, "Todos os Status")}
              </select>
            </div>

            <div>
              <select id="filtro-modalidade" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none">
                <option value="INDIVIDUAL" ${MISSOES_FILTERS.modalidade === 'INDIVIDUAL' ? 'selected' : ''}>Individual (Padrão)</option>
                <option value="EQUIPE" ${MISSOES_FILTERS.modalidade === 'EQUIPE' ? 'selected' : ''}>Equipe Policial</option>
                <option value="" ${!MISSOES_FILTERS.modalidade ? 'selected' : ''}>Todas as Modalidades</option>
              </select>
            </div>

            <div>
              <select id="filtro-ano" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none">
                <option value="">Todos os Anos</option>
                <option value="2026" ${MISSOES_FILTERS.ano === '2026' ? 'selected' : ''}>Ano 2026</option>
                <option value="2025" ${MISSOES_FILTERS.ano === '2025' ? 'selected' : ''}>Ano 2025</option>
              </select>
            </div>

            <div>
              <select id="filtro-mes" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none">
                <option value="">Todos os Meses</option>
                ${[...Array(12).keys()].map(i => {
                  const m = String(i + 1).padStart(2, '0');
                  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
                  return `<option value="${m}" ${MISSOES_FILTERS.mes === m ? 'selected' : ''}>${m} - ${meses[i]}</option>`;
                }).join('')}
              </select>
            </div>

            <div class="flex items-stretch">
              <button type="button" onclick="limparFiltrosMissoes()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-3 py-2 rounded-xl text-xs transition flex items-center justify-center" title="Limpar todos os filtros">
                ✕ Limpar Filtros
              </button>
            </div>
          </div>
        </div>

        <!-- Table (5 colunas enxutas + Ação) -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 shadow-lg">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs" id="tabela-missoes">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[10px]">
                <tr>
                  <th class="py-3 px-3">SERVIDOR RECRUTADO</th>
                  <th class="py-3 px-3">UNIDADE DESTINO</th>
                  <th class="py-3 px-3">PERÍODO (N. DIAS)</th>
                  <th class="py-3 px-3">STATUS</th>
                  <th class="py-3 px-3">TOTAL DIÁRIAS</th>
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

    // Listeners dos filtros HOT
    const onFilterChange = () => applyMissoesFilter(window.LAST_MISSOES_LIST || missoes);
    document.getElementById("filtro-busca").addEventListener("input", onFilterChange);
    document.getElementById("filtro-status").addEventListener("change", onFilterChange);
    document.getElementById("filtro-modalidade").addEventListener("change", onFilterChange);
    document.getElementById("filtro-ano").addEventListener("change", onFilterChange);
    document.getElementById("filtro-mes").addEventListener("change", onFilterChange);

    // Aplicar filtro padrão (Missões Individuais) imediatamente ao carregar
    applyMissoesFilter(missoes);

  } catch (err) {
    container.innerHTML = renderApiErrorBox("Erro ao listar recrutamentos", err, "navigate('missoes')");
  }
}

function renderMissoesRows(list) {
  if (list.length === 0) {
    return `<tr><td colspan="6" class="text-center py-8 text-slate-500">Nenhum recrutamento encontrado com os filtros aplicados.</td></tr>`;
  }
  return list.map(m => {
    const servidorNomeCompleto = m.missionario_nome || m.responsavel_nome || "Não designado";
    const unidadeDestino = m.unidade_destino || m.localidade_descricao || "-";
    return `
    <tr class="hover:bg-slate-800/40 transition">
      <td class="py-3 px-3 font-semibold text-white">
        ${escapeHtml(servidorNomeCompleto)}
      </td>
      <td class="py-3 px-3 text-slate-200 font-medium">
        ${escapeHtml(unidadeDestino)}
      </td>
      <td class="py-3 px-3 text-slate-300 whitespace-nowrap">
        ${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)} (${m.total_dias} dias)
      </td>
      <td class="py-3 px-3 whitespace-nowrap">
        <span class="badge-status ${getStatusBadgeClass(m.status_atual)} text-[10px]">${formatStatusLabel(m.status_atual)}</span>
      </td>
      <td class="py-3 px-3 font-bold text-amber-300 whitespace-nowrap">
        ${formatMoney(m.total_custo_diarias)}
      </td>
      <td class="py-3 px-3 text-right whitespace-nowrap">
        <button onclick="openMissaoDetail('${m.id}')" class="px-3 py-1 bg-pf-700 hover:bg-pf-600 text-white rounded-lg text-[11px] font-semibold transition">
          Gerenciar
        </button>
      </td>
    </tr>
  `;
  }).join('');
}

function applyMissoesFilter(allMissions) {
  const buscaRaw = document.getElementById("filtro-busca")?.value || "";
  const busca = normalizeTextKey(buscaRaw);
  const status = document.getElementById("filtro-status")?.value || "";
  const modalidade = document.getElementById("filtro-modalidade")?.value ?? MISSOES_FILTERS.modalidade;
  const ano = document.getElementById("filtro-ano")?.value || "";
  const mes = document.getElementById("filtro-mes")?.value || "";

  MISSOES_FILTERS = { busca: buscaRaw, status, modalidade, ano, mes };
  const targetStatusKey = normStatusKey(status);

  const filtered = allMissions.filter(m => {
    const matchBusca = !busca ||
      normalizeTextKey(m.titulo).includes(busca) ||
      normalizeTextKey(m.localidade_descricao).includes(busca) ||
      normalizeTextKey(m.unidade_solicitante).includes(busca) ||
      normalizeTextKey(m.unidade_destino).includes(busca) ||
      normalizeTextKey(m.setor_destino).includes(busca) ||
      normalizeTextKey(m.numero_om).includes(busca) ||
      normalizeTextKey(m.numero_pcdp).includes(busca) ||
      normalizeTextKey(m.missionario_nome).includes(busca) ||
      normalizeTextKey(m.missionario_nome_guerra).includes(busca) ||
      normalizeTextKey(m.missionario_matricula).includes(busca) ||
      normalizeTextKey(m.responsavel_nome).includes(busca) ||
      normalizeTextKey(m.responsavel_nome_guerra).includes(busca);

    const matchStatus = !targetStatusKey || normStatusKey(m.status_atual) === targetStatusKey;
    const matchModalidade = !modalidade || (m.modalidade || 'EQUIPE') === modalidade;
    const matchAno = !ano || (m.data_inicio && m.data_inicio.startsWith(ano));
    const matchMes = !mes || (m.data_inicio && m.data_inicio.slice(5, 7) === mes);

    return matchBusca && matchStatus && matchModalidade && matchAno && matchMes;
  });

  const tbody = document.getElementById("missoes-tbody");
  if (tbody) tbody.innerHTML = renderMissoesRows(filtered);
}

function limparFiltrosMissoes() {
  MISSOES_FILTERS = {
    busca: "",
    status: "",
    modalidade: "INDIVIDUAL",
    ano: "",
    mes: ""
  };
  const bEl = document.getElementById("filtro-busca");
  const sEl = document.getElementById("filtro-status");
  const mEl = document.getElementById("filtro-modalidade");
  const aEl = document.getElementById("filtro-ano");
  const msEl = document.getElementById("filtro-mes");
  if (bEl) bEl.value = "";
  if (sEl) sEl.value = "";
  if (mEl) mEl.value = "INDIVIDUAL";
  if (aEl) aEl.value = "";
  if (msEl) msEl.value = "";
  applyMissoesFilter(window.LAST_MISSOES_LIST || []);
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
  modalidade: "INDIVIDUAL",
  status: "",
  cargo: "",
  busca: ""
};

async function renderCustos(container) {
  const activeId = document.activeElement?.id;
  const cursorPos = document.activeElement?.selectionStart;
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando demonstrativo consolidado de custos...</div>`;

  try {
    const qParams = new URLSearchParams();
    if (CUSTOS_FILTERS.ano) qParams.append("ano", CUSTOS_FILTERS.ano);
    if (CUSTOS_FILTERS.mes) qParams.append("mes", CUSTOS_FILTERS.mes);
    if (CUSTOS_FILTERS.setor) qParams.append("setor", CUSTOS_FILTERS.setor);
    if (CUSTOS_FILTERS.meio_transporte) qParams.append("meio_transporte", CUSTOS_FILTERS.meio_transporte);
    if (CUSTOS_FILTERS.unidade_pb) qParams.append("unidade_pb", CUSTOS_FILTERS.unidade_pb);
    if (CUSTOS_FILTERS.modalidade) qParams.append("modalidade", CUSTOS_FILTERS.modalidade);
    if (CUSTOS_FILTERS.status) qParams.append("status", CUSTOS_FILTERS.status);

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
          const tDiarias = p.valor_total_diarias ?? p.total_diarias ?? 0;
          const vPassagem = p.valor_passagem_aerea ?? (m.meio_transporte === 'AEREO' ? (m.custo_estimado_passagens || 0) : 0);
          items.push({
            missao_id: m.id,
            titulo_missao: m.titulo,
            unidade_solicitante: m.unidade_solicitante,
            unidade_destino: m.unidade_destino || m.localidade_descricao,
            setor_destino: m.setor_destino || "-",
            modalidade: m.modalidade || "EQUIPE",
            status_atual: m.status_atual,
            meio_transporte: p.meio_transporte || m.meio_transporte || "NAO_DEFINIDO",
            servidor_matricula: p.servidor_matricula,
            servidor_nome: p.servidor_nome || m.missionario_nome || "-",
            servidor_nome_guerra: p.servidor_nome_guerra || m.missionario_nome_guerra || "",
            cargo_sigla: p.servidor_cargo || p.cargo_sigla || "-",
            data_apresentacao: p.data_apresentacao || m.data_inicio,
            data_retorno: p.data_retorno || m.data_termino,
            qtd_diarias: p.qtd_diarias || m.total_dias || 0,
            valor_diaria_unitaria: p.valor_diaria_unitaria || m.valor_diaria_padrao || 425,
            total_diarias: tDiarias,
            valor_passagem_aerea: vPassagem,
            total_custo_individual: p.custo_total_servidor ?? p.total_custo_individual ?? (tDiarias + vPassagem)
          });
        });
      } else if (m.modalidade === "INDIVIDUAL" && (m.missionario_nome || m.missionario_nome_guerra)) {
        const tDiarias = m.total_custo_diarias ?? ((m.total_dias || 0) * (m.valor_diaria_padrao || 425));
        const vPassagem = m.total_custo_passagens || m.custo_estimado_passagens || 0;
        items.push({
          missao_id: m.id,
          titulo_missao: m.titulo,
          unidade_solicitante: m.unidade_solicitante,
          unidade_destino: m.unidade_destino || m.localidade_descricao,
          setor_destino: m.setor_destino || "-",
          modalidade: "INDIVIDUAL",
          status_atual: m.status_atual,
          meio_transporte: m.meio_transporte || "NAO_DEFINIDO",
          servidor_matricula: m.missionario_matricula || "-",
          servidor_nome: m.missionario_nome || "-",
          servidor_nome_guerra: m.missionario_nome_guerra || "",
          cargo_sigla: "-",
          data_apresentacao: m.data_inicio,
          data_retorno: m.data_termino,
          qtd_diarias: m.total_dias || 0,
          valor_diaria_unitaria: m.valor_diaria_padrao || 425,
          total_diarias: tDiarias,
          valor_passagem_aerea: vPassagem,
          total_custo_individual: m.total_custo_geral ?? (tDiarias + vPassagem)
        });
      } else {
        const tDiarias = m.total_custo_diarias || 0;
        const vPassagem = m.total_custo_passagens || m.custo_estimado_passagens || 0;
        items.push({
          missao_id: m.id,
          titulo_missao: m.titulo,
          unidade_solicitante: m.unidade_solicitante,
          unidade_destino: m.unidade_destino || m.localidade_descricao,
          setor_destino: m.setor_destino || "-",
          modalidade: m.modalidade || "EQUIPE",
          status_atual: m.status_atual,
          meio_transporte: m.meio_transporte || "NAO_DEFINIDO",
          servidor_matricula: m.responsavel_matricula || "-",
          servidor_nome: m.responsavel_nome ? `${m.responsavel_nome} (+${m.total_participantes || 0} pol.)` : `Equipe (${m.total_participantes || 0} policiais)`,
          servidor_nome_guerra: m.responsavel_nome_guerra || "",
          cargo_sigla: "EQUIPE",
          data_apresentacao: m.data_inicio,
          data_retorno: m.data_termino,
          qtd_diarias: m.total_dias || 0,
          valor_diaria_unitaria: m.valor_diaria_padrao || 425,
          total_diarias: tDiarias,
          valor_passagem_aerea: vPassagem,
          total_custo_individual: m.total_custo_geral ?? (tDiarias + vPassagem)
        });
      }
    });

    // Filtros locais (busca com nome de guerra, cargo)
    if (CUSTOS_FILTERS.busca) {
      const b = normalizeTextKey(CUSTOS_FILTERS.busca);
      items = items.filter(it =>
        normalizeTextKey(it.titulo_missao).includes(b) ||
        normalizeTextKey(it.servidor_nome).includes(b) ||
        normalizeTextKey(it.servidor_nome_guerra).includes(b) ||
        normalizeTextKey(it.servidor_matricula).includes(b) ||
        normalizeTextKey(it.setor_destino).includes(b)
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
              <p class="text-xs text-slate-400 mt-1">Detalhamento individual de diárias e passagens aéreas por servidor com filtros por setor, modalidade, status, transporte e período</p>
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
          <div class="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-8 gap-2 text-xs pt-2 border-t border-slate-850">
            <div class="lg:col-span-2">
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Buscar (Nome Guerra, Policial, Setor)</label>
              <input type="text" id="custos-busca" value="${CUSTOS_FILTERS.busca}" oninput="aplicarFiltrosCustos()" placeholder="Ex: SILVEIRA, João, DRPJ..."
                     class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Modalidade</label>
              <select id="custos-modalidade" onchange="aplicarFiltrosCustos()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="INDIVIDUAL" ${CUSTOS_FILTERS.modalidade === 'INDIVIDUAL' ? 'selected' : ''}>Individual (Padrão)</option>
                <option value="EQUIPE" ${CUSTOS_FILTERS.modalidade === 'EQUIPE' ? 'selected' : ''}>Equipe</option>
                <option value="" ${!CUSTOS_FILTERS.modalidade ? 'selected' : ''}>Todas</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Status</label>
              <select id="custos-status" onchange="aplicarFiltrosCustos()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                ${renderOfficialStatusOptions(CUSTOS_FILTERS.status, "Todos os Status")}
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Setor SR/PB</label>
              <select id="custos-setor" onchange="aplicarFiltrosCustos()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos Setores</option>
                ${METADATA_CACHE.setores.map(s => `<option value="${s.sigla}" ${CUSTOS_FILTERS.setor === s.sigla ? 'selected' : ''}>${s.sigla} - ${s.nome}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Transporte</label>
              <select id="custos-transporte" onchange="aplicarFiltrosCustos()" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                <option value="">Todos</option>
                <option value="NAO_DEFINIDO" ${CUSTOS_FILTERS.meio_transporte === 'NAO_DEFINIDO' ? 'selected' : ''}>❔ Não Definido</option>
                <option value="AEREO" ${CUSTOS_FILTERS.meio_transporte === 'AEREO' ? 'selected' : ''}>✈️ Aéreo</option>
                <option value="TERRESTRE" ${CUSTOS_FILTERS.meio_transporte === 'TERRESTRE' ? 'selected' : ''}>🚗 Terrestre</option>
                <option value="PROPRIO" ${CUSTOS_FILTERS.meio_transporte === 'PROPRIO' ? 'selected' : ''}>🚙 Próprio</option>
              </select>
            </div>

            <div>
              <label class="block text-[10px] text-slate-400 uppercase font-semibold mb-1">Unidade PB / Ano</label>
              <div class="flex space-x-1">
                <select id="custos-unidade-pb" onchange="aplicarFiltrosCustos()" class="w-1/2 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
                  <option value="">PB</option>
                  <option value="SR/PF/PB" ${CUSTOS_FILTERS.unidade_pb === 'SR/PF/PB' ? 'selected' : ''}>SR/PF/PB</option>
                  <option value="DPF/CGE/PB" ${CUSTOS_FILTERS.unidade_pb === 'DPF/CGE/PB' ? 'selected' : ''}>DPF/CGE/PB</option>
                  <option value="DPF/PAT/PB" ${CUSTOS_FILTERS.unidade_pb === 'DPF/PAT/PB' ? 'selected' : ''}>DPF/PAT/PB</option>
                </select>
                <select id="custos-ano" onchange="aplicarFiltrosCustos()" class="w-1/2 bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  <option value="2026" ${CUSTOS_FILTERS.ano === '2026' ? 'selected' : ''}>2026</option>
                  <option value="2025" ${CUSTOS_FILTERS.ano === '2025' ? 'selected' : ''}>2025</option>
                  <option value="" ${!CUSTOS_FILTERS.ano ? 'selected' : ''}>Todos</option>
                </select>
              </div>
            </div>

            <div class="flex items-end">
              <button onclick="limparFiltrosCustos()" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 px-3 rounded-lg text-xs transition">
                ✕ Limpar Filtros
              </button>
            </div>
          </div>
          <div class="hidden"><select id="custos-mes"><option value="">Mês</option></select></div>
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
                  <th class="py-3 px-3">Servidor / Nome de Guerra</th>
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
                    <td class="py-3 px-3 font-semibold text-white max-w-[200px]">
                      <div class="truncate">${it.titulo_missao}</div>
                      <span class="badge-status badge-${it.modalidade} text-[9px] mt-0.5">${it.modalidade}</span>
                    </td>
                    <td class="py-3 px-3 font-semibold text-white whitespace-nowrap">
                      ${formatServidorDisplayHtml(it.servidor_nome_guerra, it.servidor_nome, it.servidor_matricula)}
                      <div class="text-[10px] text-slate-400 font-mono">Matrícula: ${it.servidor_matricula} [${it.cargo_sigla}]</div>
                    </td>
                    <td class="py-3 px-3 text-slate-200">
                      <span class="font-bold text-pf-gold">${it.setor_destino !== '-' ? it.setor_destino : ''}</span>
                      <div class="text-[10px] text-slate-400">${it.unidade_destino}</div>
                    </td>
                    <td class="py-3 px-3 whitespace-nowrap">
                      ${formatTransporteBadge(it.meio_transporte)}
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
                      <span class="badge-status ${getStatusBadgeClass(it.status_atual)} text-[10px]">${formatStatusLabel(it.status_atual)}</span>
                    </td>
                    <td class="py-3 px-3 text-right whitespace-nowrap">
                      <button onclick="openMissaoDetail('${it.missao_id}')" class="px-2.5 py-1 bg-slate-800 hover:bg-pf-700 text-white rounded text-[11px] font-semibold transition">
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

    if (activeId === "custos-busca") {
      const el = document.getElementById("custos-busca");
      if (el) {
        el.focus();
        if (typeof cursorPos === "number") el.setSelectionRange(cursorPos, cursorPos);
      }
    }

  } catch (err) {
    container.innerHTML = renderApiErrorBox("Erro ao carregar custos", err, "navigate('custos')");
  }
}

function aplicarFiltrosCustos() {
  CUSTOS_FILTERS.busca = document.getElementById("custos-busca")?.value || "";
  CUSTOS_FILTERS.modalidade = document.getElementById("custos-modalidade")?.value ?? "";
  CUSTOS_FILTERS.status = document.getElementById("custos-status")?.value || "";
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
    modalidade: "INDIVIDUAL",
    status: "",
    cargo: "",
    busca: ""
  };
  renderCustos(document.getElementById("view-container"));
}

// ==============================================================================
// SELETOR ÚNICO DE UNIDADE/CIDADE DE DESTINO + CÁLCULO AO VIVO
// ==============================================================================
function renderUnidadeDestinoOptions(unidades, selectedSigla = "") {
  return `
    <option value="">Selecione a Unidade / Cidade de Destino...</option>
    ${(unidades || []).map(u => {
      const sel = selectedSigla && u.sigla === selectedSigla ? "selected" : "";
      const vDiaria = parseFloat(u.valor_diaria || 380).toFixed(2);
      return `<option value="${escapeHtml(u.sigla)}" data-cidade="${escapeHtml(u.municipio)}/${escapeHtml(u.uf)}" data-diaria="${vDiaria}" ${sel}>${escapeHtml(u.sigla)} — ${escapeHtml(u.municipio)}/${escapeHtml(u.uf)} (R$ ${vDiaria})</option>`;
    }).join("")}
  `;
}

function filtrarUnidadeDestinoSelect(searchInputId, selectId, unidadesList) {
  const term = normalizeTextKey(document.getElementById(searchInputId)?.value || "");
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const currentVal = sel.value;
  const filtered = term
    ? (unidadesList || []).filter(u => normalizeTextKey(`${u.sigla} ${u.nome_extenso} ${u.municipio} ${u.uf}`).includes(term))
    : (unidadesList || []);

  let html = `<option value="">${term ? `✓ ${filtered.length} encontrada(s) — selecione:` : "Selecione a Unidade / Cidade de Destino..."}</option>`;
  html += filtered.map(u => {
    const vDiaria = parseFloat(u.valor_diaria || 380).toFixed(2);
    return `<option value="${escapeHtml(u.sigla)}" data-cidade="${escapeHtml(u.municipio)}/${escapeHtml(u.uf)}" data-diaria="${vDiaria}">${escapeHtml(u.sigla)} — ${escapeHtml(u.municipio)}/${escapeHtml(u.uf)} (R$ ${vDiaria})</option>`;
  }).join("");
  sel.innerHTML = html;

  if (term && filtered.length === 1) {
    sel.value = filtered[0].sigla;
    sel.dispatchEvent(new Event("change"));
  } else if (currentVal && filtered.some(u => u.sigla === currentVal)) {
    sel.value = currentVal;
  }
}

function atualizarPassagensPorDeslocamento(selectId, inputPassagensId) {
  const desl = normalizeDeslocamentoCode(document.getElementById(selectId)?.value || "NAO_DEFINIDO");
  const inp = document.getElementById(inputPassagensId);
  if (!inp) return;
  if (desl === "AEREO") {
    inp.disabled = false;
    inp.classList.remove("opacity-50", "cursor-not-allowed");
  } else {
    inp.value = "0.00";
    inp.disabled = true;
    inp.classList.add("opacity-50", "cursor-not-allowed");
  }
}

function atualizarCalculoAoVivoRecrutamento(prefix) {
  const dtInicio = document.getElementById(`${prefix}-dt-inicio`)?.value || "";
  const dtFim = document.getElementById(`${prefix}-dt-termino`)?.value || "";
  const valorDiaria = parseFloat(document.getElementById(`${prefix}-valor-diaria`)?.value || 0) || 0;
  const desl = normalizeDeslocamentoCode(document.getElementById(`${prefix}-deslocamento`)?.value || "NAO_DEFINIDO");
  const passagensInp = document.getElementById(`${prefix}-passagens`);
  const valorPassagem = desl === "AEREO" ? (parseFloat(passagensInp?.value || 0) || 0) : 0;

  const lotacao = document.getElementById(`${prefix}-srv-lotacao`)?.value || "";
  const destino = document.getElementById(`${prefix}-unidade-destino`)?.value || "";
  const mat = document.getElementById(`${prefix}-srv-matricula`)?.value?.trim() || "";
  const srvObj = (ACTIVE_SERVERS_MODAL || []).find(s => s.matricula === mat);
  const isLocalSrv = srvObj ? (srvObj.is_missionario_geral === false) : false;
  const isSameSede = Boolean(lotacao && destino && lotacao === destino);
  const isSede = isLocalSrv || isSameSede;

  const calc = calcDiasEDiariasPreview(dtInicio, dtFim, isSede);
  const totalDiarias = calc.valido ? Math.round(calc.qtdDiarias * valorDiaria * 100) / 100 : 0;
  const totalGeral = Math.round((totalDiarias + valorPassagem) * 100) / 100;

  const qteDiasEl = document.getElementById(`${prefix}-qtd-dias`);
  if (qteDiasEl) {
    if (!calc.valido) {
      qteDiasEl.textContent = "-";
    } else if (isSede) {
      qteDiasEl.textContent = `${calc.dias} dias (0,0 diárias — Sede/Local)`;
    } else {
      qteDiasEl.textContent = `${calc.dias} dia${calc.dias === 1 ? "" : "s"} (${calc.qtdDiarias.toFixed(1).replace(".", ",")} diárias)`;
    }
  }

  const totalDiariasEl = document.getElementById(`${prefix}-total-diarias`);
  if (totalDiariasEl) totalDiariasEl.textContent = formatMoney(totalDiarias);

  const resumoGeralEl = document.getElementById(`${prefix}-resumo-geral`);
  const resumoDiariasEl = document.getElementById(`${prefix}-resumo-diarias`);
  const resumoPassagensEl = document.getElementById(`${prefix}-resumo-passagens`);
  if (resumoGeralEl) resumoGeralEl.textContent = formatMoney(totalGeral);
  if (resumoDiariasEl) resumoDiariasEl.textContent = formatMoney(totalDiarias);
  if (resumoPassagensEl) resumoPassagensEl.textContent = formatMoney(valorPassagem);

  const isencaoBadge = document.getElementById(`${prefix}-isencao-aviso`);
  if (isencaoBadge) {
    if (isSede) {
      isencaoBadge.textContent = isLocalSrv
        ? "ℹ️ Isenção automática de diária: servidor cadastrado como efetivo local (sem diárias)."
        : `ℹ️ Isenção automática de diária: servidor lotado na mesma unidade de destino (${destino}).`;
      isencaoBadge.classList.remove("hidden");
    } else {
      isencaoBadge.classList.add("hidden");
    }
  }
}

// ==============================================================================
// 3. DETALHES E GESTÃO ("GERENCIAR") — FORMULÁRIO UNIFICADO
// ==============================================================================
async function openMissaoDetail(codigoOuId) {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContent.innerHTML = `<div class="p-8 text-center text-slate-400">Carregando detalhes do recrutamento...</div>`;
  modalContainer.classList.remove("hidden");

  try {
    const m = await apiFetch(`/api/missoes/${codigoOuId}`);
    const servidores = await apiFetch("/api/servidores?ativo=true");
    ACTIVE_SERVERS_MODAL = servidores;
    const unidades = METADATA_CACHE.unidades.length ? METADATA_CACHE.unidades : await apiFetch("/api/missoes/meta/unidades");
    const cargos = METADATA_CACHE.cargos.length ? METADATA_CACHE.cargos : await apiFetch("/api/missoes/meta/cargos");
    const setores = METADATA_CACHE.setores.length ? METADATA_CACHE.setores : await apiFetch("/api/missoes/meta/setores").catch(() => []);
    const papeis = METADATA_CACHE.papeis.length ? METADATA_CACHE.papeis : await apiFetch("/api/missoes/meta/papeis");

    const isGerencial = CURRENT_USER && CURRENT_USER.role === "GERENCIAL";
    const isCadastrador = CURRENT_USER && CURRENT_USER.role === "CADASTRADOR";
    const isIndividual = (m.modalidade || "INDIVIDUAL").toUpperCase() === "INDIVIDUAL";

    let srvAtual = servidores.find(s => s.matricula === m.missionario_matricula) || null;
    if (!srvAtual && m.missionario_matricula) {
      srvAtual = await apiFetch(`/api/servidores/${encodeURIComponent(m.missionario_matricula)}`).catch(() => null);
      if (srvAtual && !servidores.some(s => s.matricula === srvAtual.matricula)) {
        ACTIVE_SERVERS_MODAL = [srvAtual, ...servidores];
      }
    }

    if (isIndividual) {
      const part0 = (m.participantes && m.participantes[0]) ? m.participantes[0] : null;
      const nomeDestaque = (srvAtual?.nome_completo || m.missionario_nome || part0?.servidor_nome || m.titulo || "Servidor não definido");
      const currStatusKey = normStatusKey(m.status_atual);
      const statusTravadoCadastrador = isCadastrador && APPROVAL_RESTRICTED_STATUS_KEYS.has(currStatusKey);
      const deslocNorm = normalizeDeslocamentoCode(m.meio_transporte || part0?.meio_transporte || "NAO_DEFINIDO");
      const valorPassagemInicial = deslocNorm === "AEREO"
        ? parseFloat(m.total_custo_passagens || m.custo_estimado_passagens || 0).toFixed(2)
        : "0.00";

      modalContent.innerHTML = `
        <form id="form-gerenciar-individual" class="space-y-5 text-xs">
          <!-- Cabeçalho com Nome do Servidor em Destaque Máximo (sem badges superiores ou título longo) -->
          <div class="flex items-start justify-between border-b border-slate-800 pb-4">
            <div>
              <h2 id="edit-header-servidor-nome" class="text-xl md:text-2xl font-extrabold text-white tracking-tight uppercase">${escapeHtml(nomeDestaque)}</h2>
              <p class="text-[11px] text-slate-400 mt-1">
                Matrícula: <span id="edit-header-matricula" class="font-mono text-pf-gold font-bold">${escapeHtml(srvAtual?.matricula || m.missionario_matricula || "-")}</span>
                • Ordem de Missão (OM) / SCDP: <span class="font-mono text-slate-200">${escapeHtml(m.numero_om || "Não emitida")} / ${escapeHtml(m.numero_pcdp || "Pendente")}</span>
              </p>
            </div>
            <button type="button" onclick="closeModal()" class="text-slate-400 hover:text-white p-1 rounded-lg">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          ${isGerencial ? `
            <div class="p-3 bg-blue-950/40 border border-blue-800/60 rounded-xl text-blue-300 text-xs flex items-center space-x-2">
              <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <span><strong>Modo Consulta Gerencial:</strong> Visualização completa sem permissão de alteração.</span>
            </div>
          ` : ''}

          <!-- BLOCO 1: DADOS DO SERVIDOR (2 COLUNAS EDITÁVEL) -->
          <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <h3 class="text-xs font-bold text-pf-gold uppercase tracking-wider">Dados do Servidor</h3>
              ${!isGerencial ? `
                <div class="flex items-center space-x-2">
                  <span class="text-[10px] text-slate-400 uppercase font-semibold">Trocar servidor:</span>
                  <select id="edit-trocar-servidor" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-white max-w-xs">
                    ${ACTIVE_SERVERS_MODAL.map(s => `<option value="${escapeHtml(s.matricula)}" ${s.matricula === (srvAtual?.matricula || m.missionario_matricula) ? "selected" : ""}>${escapeHtml(s.nome_completo)} (${escapeHtml(s.matricula)})</option>`).join("")}
                  </select>
                </div>
              ` : ""}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <!-- Coluna 1 -->
              <div class="space-y-2.5">
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Nome</label>
                  <input type="text" id="edit-srv-nome" value="${escapeHtml(srvAtual?.nome_completo || m.missionario_nome || "")}" required ${isGerencial ? "disabled" : ""}
                         class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold uppercase">
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">CPF</label>
                  <input type="text" id="edit-srv-cpf" value="${escapeHtml(srvAtual?.cpf || "")}" placeholder="000.000.000-00" ${isGerencial ? "disabled" : ""}
                         class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Cargo</label>
                  <select id="edit-srv-cargo" ${isGerencial ? "disabled" : ""} class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                    ${cargos.map(c => `<option value="${escapeHtml(c.sigla)}" ${srvAtual?.cargo_sigla === c.sigla ? "selected" : ""}>${escapeHtml(c.sigla)} - ${escapeHtml(c.descricao)}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Matrícula</label>
                  <input type="text" id="edit-srv-matricula" value="${escapeHtml(srvAtual?.matricula || m.missionario_matricula || "")}" readonly
                         class="w-full bg-slate-900/60 border border-slate-800 rounded-lg p-2 text-pf-gold font-mono font-bold cursor-not-allowed">
                </div>
              </div>

              <!-- Coluna 2 -->
              <div class="space-y-2.5">
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Lotação</label>
                  <select id="edit-srv-lotacao" ${isGerencial ? "disabled" : ""} class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                    ${unidades.map(u => `<option value="${escapeHtml(u.sigla)}" ${srvAtual?.unidade_sigla === u.sigla ? "selected" : ""}>${escapeHtml(u.sigla)} - ${escapeHtml(u.nome_extenso)}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Telefone</label>
                  <input type="text" id="edit-srv-telefone" value="${escapeHtml(srvAtual?.telefone_celular || "")}" placeholder="(83) 99999-9999" ${isGerencial ? "disabled" : ""}
                         class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Login</label>
                  <input type="text" id="edit-srv-login" value="${escapeHtml(srvAtual?.login_rede || "")}" placeholder="nome.sobrenome" ${isGerencial ? "disabled" : ""}
                         class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Observação</label>
                  <textarea id="edit-missao-obs" rows="2" placeholder="Observações deste recrutamento/viagem..." ${isGerencial ? "disabled" : ""}
                            class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">${escapeHtml(m.observacoes || "")}</textarea>
                </div>
              </div>
            </div>
          </div>

          <!-- BLOCO 2: DADOS DA MISSÃO (EDITÁVEL) -->
          <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-4">
            <h3 class="text-xs font-bold text-pf-gold uppercase tracking-wider border-b border-slate-800 pb-2">Dados da Missão</h3>

            <!-- Datas e Qte Dias -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Data Início</label>
                <input type="date" id="edit-dt-inicio" value="${escapeHtml((m.data_inicio || "").slice(0, 10))}" required ${isGerencial ? "disabled" : ""}
                       class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Data Final</label>
                <input type="date" id="edit-dt-termino" value="${escapeHtml((m.data_termino || "").slice(0, 10))}" required ${isGerencial ? "disabled" : ""}
                       class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Qte Dias</label>
                <div id="edit-qtd-dias" class="w-full bg-slate-900/70 border border-slate-800 rounded-lg p-2 text-amber-300 font-bold">-</div>
              </div>
            </div>

            <!-- Local da Missão: Seletor único Unidade/Cidade + Cidade + Setor + Valor da Diária -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div class="md:col-span-2">
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Local da Missão (Unidade / Cidade Destino)</label>
                <input type="text" id="edit-unidade-search" placeholder="🔍 Filtrar unidade ou cidade..." ${isGerencial ? "disabled" : ""}
                       class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 mb-1 text-xs text-white">
                <select id="edit-unidade-destino" ${isGerencial ? "disabled" : ""} class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  ${renderUnidadeDestinoOptions(unidades, m.unidade_destino || "")}
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Cidade</label>
                <input type="text" id="edit-cidade" value="${escapeHtml(m.localidade_descricao || "")}" required ${isGerencial ? "disabled" : ""}
                       class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Setor</label>
                <select id="edit-setor" ${isGerencial ? "disabled" : ""} class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  <option value="">Nenhum / Geral</option>
                  ${setores.map(s => `<option value="${escapeHtml(s.sigla)}" ${m.setor_destino === s.sigla ? "selected" : ""}>${escapeHtml(s.sigla)} - ${escapeHtml(s.nome)}</option>`).join("")}
                </select>
              </div>
            </div>

            <!-- Diária, Deslocamento, Passagens e Total Diárias -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Valor da Diária (R$)</label>
                <input type="number" id="edit-valor-diaria" step="0.50" min="0" value="${parseFloat(m.valor_diaria_padrao || 425).toFixed(2)}" required ${isGerencial ? "disabled" : ""}
                       class="w-full bg-slate-900 border-2 border-pf-gold rounded-lg p-2 text-amber-300 font-extrabold">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Deslocamento</label>
                <select id="edit-deslocamento" ${isGerencial ? "disabled" : ""} class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
                  ${renderDeslocamentoOptions(deslocNorm)}
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Passagens: R$</label>
                <input type="number" id="edit-passagens" step="0.01" min="0" value="${valorPassagemInicial}" ${isGerencial ? "disabled" : ""}
                       class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sky-300 font-bold">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Total das Diárias: R$</label>
                <div id="edit-total-diarias" class="w-full bg-slate-900/70 border border-slate-800 rounded-lg p-2 text-emerald-400 font-extrabold">${formatMoney(m.total_custo_diarias)}</div>
              </div>
            </div>

            <div id="edit-isencao-aviso" class="hidden p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 text-[11px] font-medium"></div>

            <!-- Status, PCDP, ALOC/SAT, OM -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Status da Missão</label>
                <select id="edit-status" ${(isGerencial || statusTravadoCadastrador) ? "disabled" : ""} class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-medium">
                  ${renderOfficialStatusOptions(m.status_atual, "", true)}
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">N° PCDP</label>
                <input type="text" id="edit-pcdp" value="${escapeHtml(m.numero_pcdp || "")}" placeholder="Ex: PCDP-000101/26" ${isGerencial ? "disabled" : ""}
                       class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">N° ALOC/SAT</label>
                <input type="text" id="edit-sat" value="${escapeHtml(m.numero_sat || "")}" placeholder="Ex: SAT-2026-0001" ${isGerencial ? "disabled" : ""}
                       class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">N° OM</label>
                <input type="text" id="edit-om" value="${escapeHtml(m.numero_om || "")}" placeholder="Ex: OM-2026-0001" ${isGerencial ? "disabled" : ""}
                       class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
              </div>
            </div>
          </div>

          <!-- BARRA INFERIOR DE TOTAIS FINANCEIROS (MANTIDA CONFORME PÁGINA 3) + BOTÃO SALVAR -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs">
            <div>
              <p class="text-slate-400 uppercase font-semibold text-[10px]">Custo Geral Desta Missão</p>
              <p id="edit-resumo-geral" class="text-lg font-extrabold text-emerald-400">${formatMoney(m.total_custo_geral)}</p>
            </div>
            <div class="flex items-center space-x-6 text-right">
              <div>
                <p class="text-slate-500 text-[10px]">Subtotal Diárias:</p>
                <p id="edit-resumo-diarias" class="font-bold text-amber-300">${formatMoney(m.total_custo_diarias)}</p>
              </div>
              <div>
                <p class="text-slate-500 text-[10px]">Subtotal Passagens:</p>
                <p id="edit-resumo-passagens" class="font-bold text-blue-300">${formatMoney(m.total_custo_passagens)}</p>
              </div>
            </div>
          </div>

          <div class="flex justify-end space-x-2 pt-2 border-t border-slate-800">
            <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold">Fechar</button>
            ${!isGerencial ? `
              <button type="submit" class="px-6 py-2 bg-gradient-to-r from-pf-gold to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-slate-950 font-extrabold rounded-xl shadow-lg uppercase tracking-wider">
                SALVAR
              </button>
            ` : ""}
          </div>
        </form>
      `;

      // Eventos de interação ao vivo
      const unidSearch = document.getElementById("edit-unidade-search");
      const unidSel = document.getElementById("edit-unidade-destino");
      if (unidSearch) {
        unidSearch.addEventListener("input", () => filtrarUnidadeDestinoSelect("edit-unidade-search", "edit-unidade-destino", unidades));
      }
      if (unidSel) {
        unidSel.addEventListener("change", () => {
          const opt = unidSel.options[unidSel.selectedIndex];
          if (opt && opt.value) {
            const cid = opt.getAttribute("data-cidade");
            const dia = opt.getAttribute("data-diaria");
            if (cid) document.getElementById("edit-cidade").value = cid;
            if (dia) document.getElementById("edit-valor-diaria").value = parseFloat(dia).toFixed(2);
          }
          atualizarCalculoAoVivoRecrutamento("edit");
        });
      }

      const trocarSrv = document.getElementById("edit-trocar-servidor");
      if (trocarSrv) {
        trocarSrv.addEventListener("change", () => {
          const s = (ACTIVE_SERVERS_MODAL || []).find(x => x.matricula === trocarSrv.value);
          if (s) {
            document.getElementById("edit-srv-nome").value = s.nome_completo || "";
            document.getElementById("edit-srv-cpf").value = s.cpf || "";
            document.getElementById("edit-srv-cargo").value = s.cargo_sigla || "";
            document.getElementById("edit-srv-matricula").value = s.matricula || "";
            document.getElementById("edit-srv-lotacao").value = s.unidade_sigla || "";
            document.getElementById("edit-srv-telefone").value = s.telefone_celular || "";
            document.getElementById("edit-srv-login").value = s.login_rede || "";
            document.getElementById("edit-header-servidor-nome").textContent = s.nome_completo || "";
            document.getElementById("edit-header-matricula").textContent = s.matricula || "-";
            atualizarCalculoAoVivoRecrutamento("edit");
          }
        });
      }

      const deslSel = document.getElementById("edit-deslocamento");
      if (deslSel) {
        deslSel.addEventListener("change", () => {
          atualizarPassagensPorDeslocamento("edit-deslocamento", "edit-passagens");
          atualizarCalculoAoVivoRecrutamento("edit");
        });
      }

      ["edit-dt-inicio", "edit-dt-termino", "edit-valor-diaria", "edit-passagens", "edit-srv-lotacao"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener("input", () => atualizarCalculoAoVivoRecrutamento("edit"));
        if (el) el.addEventListener("change", () => atualizarCalculoAoVivoRecrutamento("edit"));
      });

      atualizarPassagensPorDeslocamento("edit-deslocamento", "edit-passagens");
      atualizarCalculoAoVivoRecrutamento("edit");

      document.getElementById("form-gerenciar-individual").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (isGerencial) return;

        const targetMat = document.getElementById("edit-srv-matricula").value.trim();
        const srvPayload = {
          nome_completo: document.getElementById("edit-srv-nome").value.trim().toUpperCase(),
          cpf: document.getElementById("edit-srv-cpf").value.trim(),
          cargo_sigla: document.getElementById("edit-srv-cargo").value,
          unidade_sigla: document.getElementById("edit-srv-lotacao").value,
          telefone_celular: document.getElementById("edit-srv-telefone").value.trim(),
          login_rede: document.getElementById("edit-srv-login").value.trim()
        };

        const deslVal = normalizeDeslocamentoCode(document.getElementById("edit-deslocamento").value);
        const passVal = deslVal === "AEREO" ? (parseFloat(document.getElementById("edit-passagens").value || 0) || 0) : 0.0;
        const novoStatus = document.getElementById("edit-status").value;

        const missaoPayload = {
          missionario_matricula: targetMat || null,
          observacoes: document.getElementById("edit-missao-obs").value.trim(),
          data_inicio: document.getElementById("edit-dt-inicio").value,
          data_termino: document.getElementById("edit-dt-termino").value,
          unidade_destino: document.getElementById("edit-unidade-destino").value || "",
          localidade_descricao: document.getElementById("edit-cidade").value.trim(),
          setor_destino: document.getElementById("edit-setor").value || "",
          valor_diaria_padrao: parseFloat(document.getElementById("edit-valor-diaria").value || 0),
          meio_transporte: deslVal,
          custo_estimado_passagens: passVal,
          numero_pcdp: document.getElementById("edit-pcdp").value.trim(),
          numero_sat: document.getElementById("edit-sat").value.trim(),
          numero_om: document.getElementById("edit-om").value.trim()
        };

        if (!statusTravadoCadastrador && novoStatus && normStatusKey(novoStatus) !== currStatusKey) {
          missaoPayload.status_atual = novoStatus;
        }

        try {
          if (targetMat) {
            await apiFetch(`/api/servidores/${encodeURIComponent(targetMat)}`, {
              method: "PUT",
              body: JSON.stringify(srvPayload)
            });
          }
          await apiFetch(`/api/missoes/${m.id}`, {
            method: "PUT",
            body: JSON.stringify(missaoPayload)
          });
          alert("Dados salvos com sucesso!");
          await openMissaoDetail(m.id);
          refreshUnderlyingViewIfNeeded();
        } catch (err) {
          alert(`Erro ao salvar alterações: ${err.message}`);
        }
      });

      return;
    }

    // ==========================================================================
    // MODO EQUIPE (SECUNDÁRIO / HISTÓRICO)
    // ==========================================================================
    const stKey = normStatusKey(m.status_atual);
    modalContent.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-start justify-between border-b border-slate-800 pb-4">
          <div>
            <div class="flex items-center flex-wrap gap-2">
              <span class="badge-status badge-${m.modalidade || 'EQUIPE'}">${m.modalidade || 'EQUIPE'}</span>
              <span class="badge-status ${getStatusBadgeClass(m.status_atual)}">${formatStatusLabel(m.status_atual)}</span>
            </div>
            <h2 class="text-lg font-bold text-white mt-1.5">${escapeHtml(m.titulo)}</h2>
            <p class="text-xs text-slate-400 mt-0.5">
              ${escapeHtml(m.tipo_missao)} • Destino: <strong class="text-slate-200">${escapeHtml(m.unidade_destino || m.localidade_descricao)}</strong>
              ${m.setor_destino ? ` • Setor: <strong class="text-pf-gold">${escapeHtml(m.setor_destino)}</strong>` : ''}
              • Transporte: <strong class="text-sky-300">${formatTransporteText(m.meio_transporte)}</strong>
              ${m.custo_estimado_passagens ? ` • Passagens: <strong class="text-sky-300">${formatMoney(m.custo_estimado_passagens)}</strong>` : ''}
            </p>
          </div>
          <button onclick="closeModal()" class="text-slate-400 hover:text-white p-1 rounded-lg">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-950/80 p-4 rounded-xl border border-slate-800 text-xs">
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">Período Oficial</p>
            <p class="font-bold text-white mt-0.5">${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)} (${m.total_dias} dias)</p>
          </div>
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">Chefe da Missão / Responsável</p>
            <p class="font-bold text-slate-200 mt-0.5">
              ${(m.responsavel_nome || m.responsavel_nome_guerra)
                ? `${formatServidorDisplayHtml(m.responsavel_nome_guerra, m.responsavel_nome, m.responsavel_matricula)} <span class="text-[10px] text-slate-400">(${escapeHtml(m.responsavel_matricula || '')})</span>`
                : 'Não definido'}
            </p>
          </div>
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">Ordem de Missão (OM) / SCDP</p>
            <p class="font-mono text-slate-200 mt-0.5">${escapeHtml(m.numero_om || 'Não emitida')} / ${escapeHtml(m.numero_pcdp || 'Pendente')}</p>
          </div>
        </div>

        <div class="bg-gradient-to-r from-pf-900/60 to-slate-950 border border-pf-gold/50 rounded-2xl p-4 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 class="text-sm font-bold text-white uppercase tracking-wider">Valor da Diária</h3>
          </div>
          <div class="flex items-center space-x-2">
            <div class="relative">
              <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-xs text-slate-400 font-bold">R$</span>
              <input type="number" id="input-diaria-missao" step="0.50" min="0" value="${m.valor_diaria_padrao}"
                     ${isGerencial ? 'disabled' : ''}
                     class="w-32 bg-slate-900 border-2 border-pf-gold rounded-xl pl-8 pr-3 py-2 text-sm font-extrabold text-amber-300">
            </div>
            ${!isGerencial ? `
              <button onclick="salvarNovoValorDiaria('${m.id}')" class="bg-pf-gold hover:bg-yellow-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow transition">
                Recalcular Diárias
              </button>
            ` : ''}
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
          <div class="flex items-center space-x-2">
            <span class="text-xs text-slate-400 font-semibold uppercase">Status:</span>
            <span class="badge-status ${getStatusBadgeClass(m.status_atual)} text-[10px]">${formatStatusLabel(m.status_atual)}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            ${isGerencial ? `
              <span class="text-xs text-slate-500 italic">Transição bloqueada para perfil gerencial</span>
            ` : `
              <div class="flex items-center space-x-1">
                <select id="sel-mudar-status-oficial" class="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white">
                  ${renderOfficialStatusOptions(m.status_atual, "", true)}
                </select>
                <button onclick="mudarStatusMissaoOficial('${m.id}')" class="px-2.5 py-1 bg-pf-700 hover:bg-pf-600 text-white rounded-lg text-xs font-semibold transition">
                  Alterar Status
                </button>
              </div>
              ${stKey !== 'CANCELADA' && stKey !== 'CONCLUIDO' ? `<button onclick="mudarStatusMissao('${m.id}', 'CANCELADA')" class="px-2 py-1 bg-red-900/60 hover:bg-red-800 text-red-200 rounded-lg text-xs font-semibold">Cancelar</button>` : ''}
            `}
          </div>
        </div>

        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-white uppercase tracking-wider">Servidores Designados (${m.participantes.length})</h3>
            ${!isGerencial ? `
              <button onclick="toggleFormNovoParticipante()" class="bg-pf-700 hover:bg-pf-600 text-white font-bold px-3 py-1.5 rounded-xl text-xs uppercase tracking-wider transition">
                + Adicionar Servidor
              </button>
            ` : ''}
          </div>

          <div id="form-novo-participante" class="hidden bg-slate-950 p-4 rounded-xl border border-pf-600/50 space-y-3">
            <h4 class="text-xs font-bold text-pf-gold uppercase">Designar Novo Servidor</h4>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-slate-400">Servidor Policial</label>
                  <span id="count-busca-part" class="text-[10px] text-pf-gold font-semibold">${servidores.length} disponíveis</span>
                </div>
                <input type="text" id="filtro-busca-part" oninput="updateHotServerSelect('filtro-busca-part', 'part-matricula', 'count-busca-part', 'Selecione o servidor...')" placeholder="🔍 Buscar nome, matrícula..." class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 mb-1 text-xs text-white">
                <select id="part-matricula" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  ${servidores.map(s => `<option value="${s.matricula}">${formatServidorOptionText(s)}</option>`).join('')}
                </select>
                <div id="hot-preview-part-matricula" class="hidden mt-1 space-y-1 max-h-28 overflow-y-auto bg-slate-900/90 border border-slate-700 rounded-lg p-1.5"></div>
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
                  <option value="NAO_DEFINIDO">NÃO DEFINIDO</option>
                  <option value="AEREO">AÉREO</option>
                  <option value="TERRESTRE">TERRESTRE</option>
                  <option value="PROPRIO">PRÓPRIO</option>
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

          <div class="overflow-x-auto bg-slate-950/80 rounded-xl border border-slate-800 shadow">
            <table class="w-full text-left text-xs">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[10px]">
                <tr>
                  <th class="py-2.5 px-3">Servidor</th>
                  <th class="py-2.5 px-3">Papel / Transporte</th>
                  <th class="py-2.5 px-3">Período</th>
                  <th class="py-2.5 px-3">Diárias</th>
                  <th class="py-2.5 px-3">Total Diárias</th>
                  <th class="py-2.5 px-3">Passagem</th>
                  <th class="py-2.5 px-3">Custo Total</th>
                  ${!isGerencial ? '<th class="py-2.5 px-3 text-right">Ação</th>' : ''}
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                ${m.participantes.map(p => `
                  <tr class="hover:bg-slate-800/40 transition">
                    <td class="py-3 px-3">
                      <p class="font-bold text-white">${escapeHtml(p.servidor_nome || p.servidor_matricula)}</p>
                      <p class="text-[11px] text-slate-400">Matrícula: ${escapeHtml(p.servidor_matricula)} • Lotação: ${escapeHtml(p.servidor_lotacao || '-')}</p>
                    </td>
                    <td class="py-3 px-3">
                      <p class="font-medium text-slate-200">${escapeHtml(p.papel)}</p>
                      <p class="text-[11px] text-slate-400">${formatTransporteText(p.meio_transporte)}</p>
                    </td>
                    <td class="py-3 px-3 text-slate-300">${formatDateBR(p.data_apresentacao)} a ${formatDateBR(p.data_retorno)} (${p.dias_participacao}d)</td>
                    <td class="py-3 px-3 font-bold text-amber-300">${p.is_missao_sede ? 'SEDE (0,0)' : `${p.qtd_diarias} diárias`}</td>
                    <td class="py-3 px-3 font-bold text-amber-400">${formatMoney(p.valor_total_diarias)}</td>
                    <td class="py-3 px-3 text-slate-300">${formatMoney(p.valor_passagem_aerea)}</td>
                    <td class="py-3 px-3 font-extrabold text-emerald-400">${formatMoney(p.custo_total_servidor)}</td>
                    ${!isGerencial ? `
                      <td class="py-3 px-3 text-right">
                        <button onclick="removerParticipante('${m.id}', '${p.id}')" class="p-1 text-slate-500 hover:text-red-400 rounded transition" title="Remover participante">✕</button>
                      </td>
                    ` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

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
    modalContent.innerHTML = renderApiErrorBox("Erro ao carregar missão", err, `openMissaoDetail('${codigoOuId}')`);
  }
}

function toggleFormNovoParticipante() {
  const el = document.getElementById("form-novo-participante");
  if (el) el.classList.toggle("hidden");
}

async function refreshUnderlyingViewIfNeeded() {
  const container = document.getElementById("view-container");
  if (!container) return;
  if (CURRENT_VIEW === "dashboard") await renderDashboard(container);
  else if (CURRENT_VIEW === "missoes") await renderMissoes(container);
  else if (CURRENT_VIEW === "custos") await renderCustos(container);
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
    refreshUnderlyingViewIfNeeded();
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
    refreshUnderlyingViewIfNeeded();
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
    refreshUnderlyingViewIfNeeded();
  } catch (err) {
    alert(`Falha ao designar servidor: ${err.message}`);
  }
}

async function removerParticipante(missaoId, partId) {
  if (!confirm("Deseja realmente remover esta designação de servidor da missão?")) return;
  try {
    await apiFetch(`/api/missoes/${missaoId}/participantes/${partId}`, { method: "DELETE" });
    await openMissaoDetail(missaoId);
    refreshUnderlyingViewIfNeeded();
  } catch (err) {
    alert(`Erro ao remover: ${err.message}`);
  }
}

// Modal NOVO RECRUTAMENTO ("O ideal para missão individual", com suporte secundário a EQUIPE)
async function openModalNovaMissao() {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContent.innerHTML = `<div class="p-8 text-center text-slate-400">Carregando formulário de recrutamento...</div>`;
  modalContainer.classList.remove("hidden");

  try {
    const unidades = METADATA_CACHE.unidades.length ? METADATA_CACHE.unidades : await apiFetch("/api/missoes/meta/unidades");
    const tipos = METADATA_CACHE.tipos.length ? METADATA_CACHE.tipos : await apiFetch("/api/missoes/meta/tipos");
    const cargos = METADATA_CACHE.cargos.length ? METADATA_CACHE.cargos : await apiFetch("/api/missoes/meta/cargos");
    const setores = METADATA_CACHE.setores.length ? METADATA_CACHE.setores : await apiFetch("/api/missoes/meta/setores").catch(() => []);
    const servidores = await apiFetch("/api/servidores?ativo=true");
    ACTIVE_SERVERS_MODAL = servidores;
    window.SELECTED_EQUIPE_MATRICULAS = new Set();
    const diariaBase = SYSTEM_CONFIG.valor_diaria_padrao || "425.00";

    modalContent.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 class="text-lg font-extrabold text-white tracking-tight uppercase">NOVO RECRUTAMENTO</h2>
            <p class="text-xs text-slate-400">O ideal para missão individual • Preenchimento rápido com cálculo automático</p>
          </div>
          <button type="button" onclick="closeModal()" class="text-slate-400 hover:text-white text-lg">&times;</button>
        </div>

        <form id="form-criar-missao" class="space-y-4 text-xs">
          <!-- MODALIDADE SELETOR (INDIVIDUAL É O PADRÃO) -->
          <div class="bg-slate-950/70 p-3 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span class="font-bold text-slate-300 uppercase text-[11px]">Modalidade:</span>
            <div class="flex items-center space-x-5">
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

          <!-- BLOCO 1 INDIVIDUAL: DADOS DO SERVIDOR (2 COLUNAS) -->
          <div id="container-nr-servidor-individual" class="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
              <h3 class="text-xs font-bold text-pf-gold uppercase tracking-wider">Dados do Servidor</h3>
              <div class="flex flex-wrap items-center gap-2 flex-1 md:justify-end">
                <input type="text" id="nr-busca-servidor" placeholder="🔍 Buscar servidor cadastrado (nome, CPF, matrícula)..."
                       class="w-full md:w-64 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-white focus:border-pf-gold focus:outline-none">
                <select id="nr-select-servidor" class="w-full md:w-64 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white">
                  <option value="">Selecionar servidor cadastrado (ou preencher novo)...</option>
                  ${servidores.map(s => `<option value="${escapeHtml(s.matricula)}">${escapeHtml(s.nome_completo)} (${escapeHtml(s.matricula)})</option>`).join("")}
                </select>
                <button type="button" id="nr-btn-limpar-servidor" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[11px] font-semibold">
                  Novo / Limpar
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <!-- Coluna 1 -->
              <div class="space-y-2.5">
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Nome *</label>
                  <input type="text" id="nr-srv-nome" placeholder="NOME COMPLETO DO SERVIDOR" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold uppercase">
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">CPF</label>
                  <input type="text" id="nr-srv-cpf" placeholder="000.000.000-00" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Cargo *</label>
                  <select id="nr-srv-cargo" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                    ${cargos.map(c => `<option value="${escapeHtml(c.sigla)}">${escapeHtml(c.sigla)} - ${escapeHtml(c.descricao)}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Matrícula *</label>
                  <input type="text" id="nr-srv-matricula" placeholder="Ex: 31450" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-pf-gold font-mono font-bold">
                </div>
              </div>

              <!-- Coluna 2 -->
              <div class="space-y-2.5">
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Lotação *</label>
                  <select id="nr-srv-lotacao" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                    ${unidades.map(u => `<option value="${escapeHtml(u.sigla)}">${escapeHtml(u.sigla)} - ${escapeHtml(u.nome_extenso)}</option>`).join("")}
                  </select>
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Telefone</label>
                  <input type="text" id="nr-srv-telefone" placeholder="(83) 99999-9999" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Login</label>
                  <input type="text" id="nr-srv-login" placeholder="nome.sobrenome" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
                </div>
                <div>
                  <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Observação</label>
                  <textarea id="nr-observacoes" rows="2" placeholder="Observações deste recrutamento..." class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"></textarea>
                </div>
              </div>
            </div>
          </div>

          <!-- BLOCO EQUIPE (VISÍVEL APENAS SE MODALIDADE = EQUIPE) -->
          <div id="container-equipe-wrapper" class="hidden space-y-3 bg-slate-950/70 border border-blue-800/60 rounded-2xl p-4">
            <h3 class="text-xs font-bold text-blue-300 uppercase tracking-wider border-b border-slate-800 pb-2">Dados da Equipe Policial</h3>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div class="md:col-span-2">
                <label class="block text-slate-400 mb-1">Título da Missão</label>
                <input type="text" id="nova-titulo" placeholder="Ex: Operação Fronteira Segura 2026" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
              </div>
              <div>
                <label class="block text-slate-400 mb-1">Tipo de Missão</label>
                <select id="nova-tipo" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  ${tipos.map(t => `<option value="${escapeHtml(t.nome)}">${escapeHtml(t.nome)}</option>`).join("")}
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1">Unidade Solicitante</label>
                <select id="nova-solicitante" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  ${unidades.map(u => `<option value="${escapeHtml(u.sigla)}">${escapeHtml(u.sigla)} - ${escapeHtml(u.nome_extenso)}</option>`).join("")}
                </select>
              </div>
              <div class="md:col-span-2">
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-slate-300 font-semibold">Chefe da Missão / Responsável</label>
                  <span id="count-busca-responsavel" class="text-[10px] text-pf-gold font-semibold">${servidores.length} disponíveis</span>
                </div>
                <input type="text" id="filtro-busca-responsavel" oninput="filtrarOpcoesResponsavel()" placeholder="🔍 Pesquisar chefe..." class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 mb-1 text-xs text-white">
                <select id="nova-responsavel" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  <option value="">Selecione o chefe da missão...</option>
                  ${servidores.map(s => `<option value="${escapeHtml(s.matricula)}">${formatServidorOptionText(s)}</option>`).join("")}
                </select>
                <div id="hot-preview-nova-responsavel" class="hidden mt-1 space-y-1 max-h-28 overflow-y-auto bg-slate-900/95 border border-slate-700 rounded-lg p-1.5"></div>
              </div>
            </div>

            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="font-bold text-blue-300 text-xs uppercase">Servidores da Equipe (<span id="count-busca-equipe" class="text-pf-gold">${servidores.length}</span>)</span>
                <button type="button" onclick="openSubModalNovoServidor('equipe-servidores')" class="px-2.5 py-1 bg-pf-800 hover:bg-pf-700 text-pf-gold border border-pf-gold/50 rounded-lg text-xs font-bold transition">
                  + Cadastrar Novo Servidor
                </button>
              </div>
              <input type="text" id="filtro-busca-equipe" oninput="filtrarOpcoesEquipe()" placeholder="🔍 Busca HOT por nome de guerra, nome, cargo ou matrícula..." class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white">
              <div id="lista-equipe-servidores" class="max-h-40 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-2 p-2 bg-slate-900 rounded-lg border border-slate-800">
                ${renderEquipeChecklistHtml(servidores)}
              </div>
            </div>
          </div>

          <!-- BLOCO 2: DADOS DA MISSÃO -->
          <div class="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 space-y-4">
            <h3 class="text-xs font-bold text-pf-gold uppercase tracking-wider border-b border-slate-800 pb-2">Dados da Missão</h3>

            <!-- Datas e Qte Dias -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Data Início *</label>
                <input type="date" id="nr-dt-inicio" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Data Final *</label>
                <input type="date" id="nr-dt-termino" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Qte Dias</label>
                <div id="nr-qtd-dias" class="w-full bg-slate-900/70 border border-slate-800 rounded-lg p-2 text-amber-300 font-bold">-</div>
              </div>
            </div>

            <!-- Local da Missão -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div class="md:col-span-2">
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Local da Missão (Unidade / Cidade Destino)</label>
                <input type="text" id="nr-unidade-search" placeholder="🔍 Filtrar unidade ou cidade..." class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 mb-1 text-xs text-white">
                <select id="nr-unidade-destino" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  ${renderUnidadeDestinoOptions(unidades, "")}
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Cidade *</label>
                <input type="text" id="nr-cidade" placeholder="Ex: João Pessoa/PB" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Setor</label>
                <select id="nr-setor" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
                  <option value="">Nenhum / Geral</option>
                  ${setores.map(s => `<option value="${escapeHtml(s.sigla)}">${escapeHtml(s.sigla)} - ${escapeHtml(s.nome)}</option>`).join("")}
                </select>
              </div>
            </div>

            <!-- Valor da Diária, Deslocamento, Passagens, Total Diárias -->
            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Valor da Diária (R$)</label>
                <input type="number" id="nr-valor-diaria" step="0.50" min="0" value="${parseFloat(diariaBase).toFixed(2)}" required
                       class="w-full bg-slate-900 border-2 border-pf-gold rounded-lg p-2 text-amber-300 font-extrabold">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Deslocamento</label>
                <select id="nr-deslocamento" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
                  ${renderDeslocamentoOptions("NAO_DEFINIDO")}
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Passagens: R$</label>
                <input type="number" id="nr-passagens" step="0.01" min="0" value="0.00" disabled
                       class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sky-300 font-bold opacity-50 cursor-not-allowed">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Total das Diárias: R$</label>
                <div id="nr-total-diarias" class="w-full bg-slate-900/70 border border-slate-800 rounded-lg p-2 text-emerald-400 font-extrabold">R$ 0,00</div>
              </div>
            </div>

            <div id="nr-isencao-aviso" class="hidden p-2.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 text-[11px] font-medium"></div>

            <!-- Status da Missão, N° PCDP, N° ALOC/SAT -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">Status da Missão</label>
                <select id="nr-status" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-medium">
                  ${renderOfficialStatusOptions("Indicado", "", true)}
                </select>
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">N° PCDP</label>
                <input type="text" id="nr-pcdp" placeholder="Ex: PCDP-000101/26" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
              </div>
              <div>
                <label class="block text-slate-400 mb-1 uppercase text-[10px] font-semibold">N° ALOC/SAT</label>
                <input type="text" id="nr-sat" placeholder="Ex: SAT-2026-0000" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
              </div>
            </div>
          </div>

          <!-- Resumo Financeiro ao Vivo -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs">
            <div>
              <p class="text-slate-400 uppercase font-semibold text-[10px]">Custo Geral Previsto</p>
              <p id="nr-resumo-geral" class="text-lg font-extrabold text-emerald-400">R$ 0,00</p>
            </div>
            <div class="flex items-center space-x-6 text-right">
              <div>
                <p class="text-slate-500 text-[10px]">Subtotal Diárias:</p>
                <p id="nr-resumo-diarias" class="font-bold text-amber-300">R$ 0,00</p>
              </div>
              <div>
                <p class="text-slate-500 text-[10px]">Subtotal Passagens:</p>
                <p id="nr-resumo-passagens" class="font-bold text-blue-300">R$ 0,00</p>
              </div>
            </div>
          </div>

          <div class="flex justify-end space-x-2 pt-2 border-t border-slate-800">
            <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold">Cancelar</button>
            <button type="submit" class="px-6 py-2 bg-gradient-to-r from-pf-gold to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-slate-950 font-extrabold rounded-xl shadow-lg uppercase tracking-wider">
              SALVAR
            </button>
          </div>
        </form>
      </div>
    `;

    // Helper para preencher campos do servidor selecionado
    const preencherCamposServidorNr = (s) => {
      if (!s) {
        document.getElementById("nr-srv-nome").value = "";
        document.getElementById("nr-srv-cpf").value = "";
        document.getElementById("nr-srv-matricula").value = "";
        document.getElementById("nr-srv-telefone").value = "";
        document.getElementById("nr-srv-login").value = "";
      } else {
        document.getElementById("nr-srv-nome").value = s.nome_completo || "";
        document.getElementById("nr-srv-cpf").value = s.cpf || "";
        document.getElementById("nr-srv-cargo").value = s.cargo_sigla || cargos[0]?.sigla || "APF";
        document.getElementById("nr-srv-matricula").value = s.matricula || "";
        document.getElementById("nr-srv-lotacao").value = s.unidade_sigla || unidades[0]?.sigla || "SR/PF/PB";
        document.getElementById("nr-srv-telefone").value = s.telefone_celular || "";
        document.getElementById("nr-srv-login").value = s.login_rede || "";
      }
      atualizarCalculoAoVivoRecrutamento("nr");
    };

    const nrBuscaSrv = document.getElementById("nr-busca-servidor");
    const nrSelSrv = document.getElementById("nr-select-servidor");
    if (nrBuscaSrv && nrSelSrv) {
      nrBuscaSrv.addEventListener("input", () => {
        const term = normalizeTextKey(nrBuscaSrv.value);
        const lista = ACTIVE_SERVERS_MODAL || [];
        const filtered = term ? lista.filter(s => servidorMatchesTerm(s, term) || normalizeTextKey(s.cpf || "").includes(term)) : lista;
        let html = `<option value="">${term ? `✓ ${filtered.length} encontrado(s) — selecione:` : "Selecionar servidor cadastrado (ou preencher novo)..."}</option>`;
        html += filtered.map(s => `<option value="${escapeHtml(s.matricula)}">${escapeHtml(s.nome_completo)} (${escapeHtml(s.matricula)})</option>`).join("");
        nrSelSrv.innerHTML = html;
        if (term && filtered.length === 1) {
          nrSelSrv.value = filtered[0].matricula;
          preencherCamposServidorNr(filtered[0]);
        }
      });

      nrSelSrv.addEventListener("change", () => {
        const s = (ACTIVE_SERVERS_MODAL || []).find(x => x.matricula === nrSelSrv.value);
        preencherCamposServidorNr(s || null);
      });
    }

    document.getElementById("nr-btn-limpar-servidor")?.addEventListener("click", () => {
      if (nrBuscaSrv) nrBuscaSrv.value = "";
      if (nrSelSrv) nrSelSrv.value = "";
      preencherCamposServidorNr(null);
      document.getElementById("nr-srv-nome")?.focus();
    });

    // Lookup automático ao digitar matrícula de servidor existente
    document.getElementById("nr-srv-matricula")?.addEventListener("blur", () => {
      const mat = document.getElementById("nr-srv-matricula").value.trim();
      const s = (ACTIVE_SERVERS_MODAL || []).find(x => x.matricula === mat);
      if (s && !document.getElementById("nr-srv-nome").value.trim()) {
        preencherCamposServidorNr(s);
        if (nrSelSrv) nrSelSrv.value = s.matricula;
      }
      atualizarCalculoAoVivoRecrutamento("nr");
    });

    // Unidade / Cidade de Destino
    const nrUnidSearch = document.getElementById("nr-unidade-search");
    const nrUnidSel = document.getElementById("nr-unidade-destino");
    if (nrUnidSearch) {
      nrUnidSearch.addEventListener("input", () => filtrarUnidadeDestinoSelect("nr-unidade-search", "nr-unidade-destino", unidades));
    }
    if (nrUnidSel) {
      nrUnidSel.addEventListener("change", () => {
        const opt = nrUnidSel.options[nrUnidSel.selectedIndex];
        if (opt && opt.value) {
          const cid = opt.getAttribute("data-cidade");
          const dia = opt.getAttribute("data-diaria");
          if (cid) document.getElementById("nr-cidade").value = cid;
          if (dia) document.getElementById("nr-valor-diaria").value = parseFloat(dia).toFixed(2);
        }
        atualizarCalculoAoVivoRecrutamento("nr");
      });
    }

    // Deslocamento e Passagens
    document.getElementById("nr-deslocamento")?.addEventListener("change", () => {
      atualizarPassagensPorDeslocamento("nr-deslocamento", "nr-passagens");
      atualizarCalculoAoVivoRecrutamento("nr");
    });

    ["nr-dt-inicio", "nr-dt-termino", "nr-valor-diaria", "nr-passagens", "nr-srv-lotacao"].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", () => atualizarCalculoAoVivoRecrutamento("nr"));
        el.addEventListener("change", () => atualizarCalculoAoVivoRecrutamento("nr"));
      }
    });

    toggleModalidadeFields();
    atualizarPassagensPorDeslocamento("nr-deslocamento", "nr-passagens");
    atualizarCalculoAoVivoRecrutamento("nr");

    document.getElementById("form-criar-missao").addEventListener("submit", async (e) => {
      e.preventDefault();
      const modalidade = document.querySelector('input[name="nova-modalidade"]:checked')?.value || "INDIVIDUAL";
      const deslVal = normalizeDeslocamentoCode(document.getElementById("nr-deslocamento").value);
      const passagensVal = deslVal === "AEREO" ? (parseFloat(document.getElementById("nr-passagens").value || 0) || 0) : 0.0;
      const unidadeDest = document.getElementById("nr-unidade-destino").value || null;
      const cidadeVal = document.getElementById("nr-cidade").value.trim();
      const setorVal = document.getElementById("nr-setor").value || null;
      const dtInicio = document.getElementById("nr-dt-inicio").value;
      const dtTermino = document.getElementById("nr-dt-termino").value;
      const valorDiaria = parseFloat(document.getElementById("nr-valor-diaria").value || 425);
      const statusVal = document.getElementById("nr-status")?.value || "Indicado";
      const pcdpVal = document.getElementById("nr-pcdp").value.trim() || null;
      const satVal = document.getElementById("nr-sat").value.trim() || null;
      const obsVal = document.getElementById("nr-observacoes")?.value.trim() || null;

      let missionarioMatricula = null;
      let responsavelMatricula = null;
      let equipeMatriculas = [];
      let tituloPayload = null;
      let tipoPayload = null;
      let solicitantePayload = null;

      if (modalidade === "INDIVIDUAL") {
        const srvNome = document.getElementById("nr-srv-nome").value.trim().toUpperCase();
        const srvCpf = document.getElementById("nr-srv-cpf").value.trim();
        const srvCargo = document.getElementById("nr-srv-cargo").value;
        const srvMat = document.getElementById("nr-srv-matricula").value.trim();
        const srvLotacao = document.getElementById("nr-srv-lotacao").value;
        const srvTel = document.getElementById("nr-srv-telefone").value.trim();
        const srvLogin = document.getElementById("nr-srv-login").value.trim();

        if (!srvMat || !srvNome) {
          alert("Informe ao menos o Nome e a Matrícula do servidor recrutado.");
          return;
        }

        const existingSrv = (ACTIVE_SERVERS_MODAL || []).find(s => s.matricula === srvMat);
        try {
          if (!existingSrv) {
            const criadoSrv = await apiFetch("/api/servidores", {
              method: "POST",
              body: JSON.stringify({
                matricula: srvMat,
                nome_completo: srvNome,
                cpf: srvCpf || null,
                cargo_sigla: srvCargo,
                unidade_sigla: srvLotacao,
                telefone_celular: srvTel || null,
                login_rede: srvLogin || null,
                ativo: true,
                is_missionario_geral: true
              })
            });
            ACTIVE_SERVERS_MODAL.unshift(criadoSrv);
          } else {
            await apiFetch(`/api/servidores/${encodeURIComponent(srvMat)}`, {
              method: "PUT",
              body: JSON.stringify({
                nome_completo: srvNome,
                cpf: srvCpf,
                cargo_sigla: srvCargo,
                unidade_sigla: srvLotacao,
                telefone_celular: srvTel,
                login_rede: srvLogin
              })
            });
          }
        } catch (srvErr) {
          alert(`Erro ao salvar dados do servidor: ${srvErr.message}`);
          return;
        }
        missionarioMatricula = srvMat;
        solicitantePayload = srvLotacao || "SR/PF/PB";
      } else {
        responsavelMatricula = document.getElementById("nova-responsavel")?.value || null;
        equipeMatriculas = Array.from(window.SELECTED_EQUIPE_MATRICULAS || []);
        tituloPayload = document.getElementById("nova-titulo")?.value.trim() || null;
        tipoPayload = document.getElementById("nova-tipo")?.value || null;
        solicitantePayload = document.getElementById("nova-solicitante")?.value || "SR/PF/PB";
      }

      const payload = {
        titulo: tituloPayload,
        tipo_missao: tipoPayload,
        modalidade: modalidade,
        unidade_solicitante: solicitantePayload,
        unidade_destino: unidadeDest,
        setor_destino: setorVal,
        meio_transporte: deslVal,
        custo_estimado_passagens: passagensVal,
        localidade_descricao: cidadeVal,
        data_inicio: dtInicio,
        data_termino: dtTermino,
        valor_diaria_padrao: valorDiaria,
        responsavel_matricula: responsavelMatricula,
        missionario_matricula: missionarioMatricula,
        servidores_matriculas: equipeMatriculas,
        servidores_equipe_matriculas: equipeMatriculas,
        numero_pcdp: pcdpVal,
        numero_sat: satVal,
        observacoes: obsVal,
        status_atual: statusVal
      };

      try {
        const criada = await apiFetch("/api/missoes", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        closeModal();
        await navigate("missoes");
        openMissaoDetail(criada.id);
      } catch (err) {
        alert(`Erro ao salvar recrutamento: ${err.message}`);
      }
    });
  } catch (err) {
    modalContent.innerHTML = renderApiErrorBox("Erro ao abrir Novo Recrutamento", err, "openModalNovaMissao()");
  }
}

function toggleModalidadeFields() {
  const modalidade = document.querySelector('input[name="nova-modalidade"]:checked')?.value || "INDIVIDUAL";
  const containerInd = document.getElementById("container-nr-servidor-individual");
  const containerEq = document.getElementById("container-equipe-wrapper");

  if (modalidade === "INDIVIDUAL") {
    if (containerInd) containerInd.classList.remove("hidden");
    if (containerEq) containerEq.classList.add("hidden");
  } else {
    if (containerInd) containerInd.classList.add("hidden");
    if (containerEq) containerEq.classList.remove("hidden");
  }
}

function toggleNovaMissaoTransporte() {
  atualizarPassagensPorDeslocamento("nr-deslocamento", "nr-passagens");
}

function autoAjustarDiariaPorDestino() {
  const sel = document.getElementById("nr-unidade-destino");
  if (sel) sel.dispatchEvent(new Event("change"));
}

function updateHotServerSelect(inputId, selectId, countId, emptyPlaceholder) {
  const term = document.getElementById(inputId)?.value || "";
  const select = document.getElementById(selectId);
  const countEl = document.getElementById(countId);
  const previewEl = document.getElementById(`hot-preview-${selectId}`);
  if (!select) return;

  const prevVal = select.value;
  const lista = ACTIVE_SERVERS_MODAL || [];
  const filtered = term.trim() ? lista.filter(s => servidorMatchesTerm(s, term)) : lista;

  if (countEl) {
    countEl.textContent = term.trim()
      ? `(${filtered.length} de ${lista.length} encontrado${filtered.length === 1 ? '' : 's'})`
      : `(${lista.length} disponíveis)`;
  }

  let html = "";
  if (filtered.length === 0) {
    html = `<option value="">Nenhum policial encontrado para "${escapeHtml(term)}"</option>`;
  } else {
    if (!(term.trim() && filtered.length === 1)) {
      html += `<option value="">${term.trim() ? `✓ ${filtered.length} encontrado(s) — selecione:` : emptyPlaceholder}</option>`;
    }
    html += filtered.map(s => `<option value="${s.matricula}">${formatServidorOptionText(s)}</option>`).join("");
  }
  select.innerHTML = html;

  if (term.trim() && filtered.length > 0) {
    if (filtered.length === 1) {
      select.value = filtered[0].matricula;
    } else if (filtered.some(s => s.matricula === prevVal)) {
      select.value = prevVal;
    } else {
      select.value = filtered[0].matricula;
    }
  } else if (prevVal && filtered.some(s => s.matricula === prevVal)) {
    select.value = prevVal;
  }

  if (previewEl) {
    if (term.trim() && filtered.length > 0) {
      previewEl.innerHTML = filtered.slice(0, 8).map(s => `
        <button type="button" onclick="selecionarServidorHot('${selectId}', '${s.matricula}', '${inputId}', '${countId}', '${emptyPlaceholder}')"
                class="w-full text-left px-2.5 py-1.5 rounded hover:bg-slate-800 transition flex items-center justify-between text-xs ${select.value === s.matricula ? 'bg-slate-800 border border-pf-gold/50' : ''}">
          <span>[${s.cargo_sigla}] ${formatServidorDisplayHtml(s.nome_guerra, s.nome_completo, s.matricula)} <span class="text-[10px] text-slate-400">(${s.unidade_sigla})</span></span>
          <span class="text-[10px] text-pf-gold font-mono">Mat. ${s.matricula}</span>
        </button>
      `).join("");
      previewEl.classList.remove("hidden");
    } else {
      previewEl.innerHTML = "";
      previewEl.classList.add("hidden");
    }
  }
}

function selecionarServidorHot(selectId, matricula, inputId, countId, emptyPlaceholder) {
  const select = document.getElementById(selectId);
  if (select) select.value = matricula;
  const previewEl = document.getElementById(`hot-preview-${selectId}`);
  if (previewEl) previewEl.classList.add("hidden");
  const inp = document.getElementById(inputId);
  if (inp) {
    const s = (ACTIVE_SERVERS_MODAL || []).find(x => x.matricula === matricula);
    if (s) inp.value = s.nome_guerra || s.nome_completo;
  }
}

function filtrarOpcoesMissionario() {
  updateHotServerSelect("filtro-busca-missionario", "nova-missionario", "count-busca-missionario", "Selecione o servidor executor...");
}

function filtrarOpcoesResponsavel() {
  updateHotServerSelect("filtro-busca-responsavel", "nova-responsavel", "count-busca-responsavel", "Selecione o chefe da missão...");
}

function renderEquipeChecklistHtml(servidoresList) {
  if (!servidoresList || servidoresList.length === 0) {
    return `<p class="text-xs text-slate-500 p-2 col-span-2 text-center">Nenhum servidor encontrado.</p>`;
  }
  const selectedSet = window.SELECTED_EQUIPE_MATRICULAS || new Set();
  return servidoresList.map(s => {
    const checked = selectedSet.has(s.matricula) ? "checked" : "";
    return `
      <label class="equipe-srv-item flex items-center space-x-2 p-1.5 rounded hover:bg-slate-800 cursor-pointer">
        <input type="checkbox" name="chk-equipe-srv" value="${s.matricula}" ${checked} onchange="toggleEquipeCheckbox(this)" class="rounded bg-slate-950 border-slate-700 text-pf-gold focus:ring-0">
        <span class="text-xs text-slate-200 truncate">[${s.cargo_sigla}] ${formatServidorDisplayHtml(s.nome_guerra, s.nome_completo, s.matricula)} <span class="text-[10px] text-slate-400">(${s.matricula})</span></span>
      </label>
    `;
  }).join("");
}

function toggleEquipeCheckbox(chk) {
  if (!window.SELECTED_EQUIPE_MATRICULAS) window.SELECTED_EQUIPE_MATRICULAS = new Set();
  if (chk.checked) window.SELECTED_EQUIPE_MATRICULAS.add(chk.value);
  else window.SELECTED_EQUIPE_MATRICULAS.delete(chk.value);
}

function filtrarOpcoesEquipe() {
  const term = document.getElementById("filtro-busca-equipe")?.value || "";
  const lista = ACTIVE_SERVERS_MODAL || [];
  const filtered = term.trim() ? lista.filter(s => servidorMatchesTerm(s, term)) : lista;
  const container = document.getElementById("lista-equipe-servidores");
  const countEl = document.getElementById("count-busca-equipe");
  if (container) container.innerHTML = renderEquipeChecklistHtml(filtered);
  if (countEl) {
    countEl.textContent = term.trim()
      ? `${filtered.length} de ${lista.length} encontrados`
      : `${lista.length} disponíveis`;
  }
}

// Sub-modal para cadastro rápido de novo servidor (usado em EQUIPE)
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
            <label class="block text-slate-400 mb-1">Matrícula Funcional *</label>
            <input type="text" id="sub-srv-matricula" required placeholder="Ex: 31450" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">CPF</label>
            <input type="text" id="sub-srv-cpf" placeholder="000.000.000-00" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Cargo / Carreira</label>
            <select id="sub-srv-cargo" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white">
              ${METADATA_CACHE.cargos.map(c => `<option value="${c.sigla}">${c.sigla} - ${c.descricao}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Unidade de Lotação</label>
            <select id="sub-srv-unidade" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white">
              ${METADATA_CACHE.unidades.map(u => `<option value="${u.sigla}">${u.sigla}</option>`).join('')}
            </select>
          </div>
          <div class="col-span-2">
            <label class="block text-slate-400 mb-1">Nome Completo *</label>
            <input type="text" id="sub-srv-nome" required placeholder="NOME DO POLICIAL FEDERAL" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white font-semibold uppercase">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Telefone</label>
            <input type="text" id="sub-srv-telefone" placeholder="(83) 99999-9999" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Login</label>
            <input type="text" id="sub-srv-login" placeholder="nome.sobrenome" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-white font-mono">
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
    const cpf = document.getElementById("sub-srv-cpf").value.trim() || null;
    const nome = document.getElementById("sub-srv-nome").value.trim().toUpperCase();
    const cargo = document.getElementById("sub-srv-cargo").value;
    const unidade = document.getElementById("sub-srv-unidade").value;
    const telefone = document.getElementById("sub-srv-telefone").value.trim() || null;
    const login = document.getElementById("sub-srv-login").value.trim() || null;

    try {
      const criado = await apiFetch("/api/servidores", {
        method: "POST",
        body: JSON.stringify({
          matricula,
          cpf,
          nome_completo: nome,
          cargo_sigla: cargo,
          unidade_sigla: unidade,
          telefone_celular: telefone,
          login_rede: login,
          ativo: true,
          is_missionario_geral: true
        })
      });

      if (!Array.isArray(ACTIVE_SERVERS_MODAL)) ACTIVE_SERVERS_MODAL = [];
      ACTIVE_SERVERS_MODAL.unshift(criado);

      if (!window.SELECTED_EQUIPE_MATRICULAS) window.SELECTED_EQUIPE_MATRICULAS = new Set();
      window.SELECTED_EQUIPE_MATRICULAS.add(criado.matricula);
      filtrarOpcoesEquipe();

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
          <div class="flex justify-end pt-1">
            <button id="btn-limpar-filtros-srv" type="button" class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition font-semibold">
              ✕ Limpar Filtros
            </button>
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
    document.getElementById("btn-limpar-filtros-srv")?.addEventListener("click", () => {
      document.getElementById("filtro-srv-busca").value = "";
      document.getElementById("filtro-srv-cargo").value = "";
      document.getElementById("filtro-srv-unidade").value = "";
      document.getElementById("filtro-srv-status").value = "";
      document.getElementById("filtro-srv-tpe").value = "";
      document.getElementById("filtro-srv-miss").value = "";
      applyServidoresFilter(servidores);
    });

  } catch (err) {
    container.innerHTML = renderApiErrorBox("Erro ao listar servidores", err, "navigate('servidores')");
  }
}

function renderServidoresRows(servidores) {
  if (servidores.length === 0) {
    return `<tr><td colspan="8" class="text-center py-8 text-slate-500">Nenhum servidor encontrado.</td></tr>`;
  }
  return servidores.map(s => `
    <tr class="hover:bg-slate-800/40 transition">
      <td class="py-3 px-3 font-mono font-bold text-pf-gold">
        <p>${escapeHtml(s.matricula)}</p>
        ${s.cpf ? `<p class="text-[10px] text-slate-400 font-normal">CPF: ${escapeHtml(s.cpf)}</p>` : ''}
      </td>
      <td class="py-3 px-3">
        ${s.nome_guerra ? `<p class="font-bold text-pf-gold uppercase tracking-wide">${escapeHtml(s.nome_guerra)}</p><p class="text-[11px] text-slate-300">${escapeHtml(s.nome_completo)}</p>` : `<p class="font-bold text-white">${escapeHtml(s.nome_completo)}</p>`}
      </td>
      <td class="py-3 px-3">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-blue-300 border border-slate-700">
          ${escapeHtml(s.cargo_sigla)}
        </span>
      </td>
      <td class="py-3 px-3 font-semibold text-slate-200">${escapeHtml(s.unidade_sigla)}</td>
      <td class="py-3 px-3 text-slate-300">
        <p>${escapeHtml(s.login_rede || s.email_institucional || '-')}</p>
        <p class="text-[11px] text-slate-500">${escapeHtml(s.telefone_celular || '-')}</p>
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
  const busca = normalizeTextKey(document.getElementById("filtro-srv-busca").value);
  const cargo = document.getElementById("filtro-srv-cargo").value;
  const unidade = document.getElementById("filtro-srv-unidade").value;
  const status = document.getElementById("filtro-srv-status").value;
  const tpe = document.getElementById("filtro-srv-tpe") ? document.getElementById("filtro-srv-tpe").value : "";
  const miss = document.getElementById("filtro-srv-miss") ? document.getElementById("filtro-srv-miss").value : "";

  const filtered = allServidores.filter(s => {
    const matchBusca = !busca ||
      normalizeTextKey(s.matricula).includes(busca) ||
      normalizeTextKey(s.nome_completo).includes(busca) ||
      normalizeTextKey(s.nome_guerra || "").includes(busca) ||
      normalizeTextKey(s.cpf || "").includes(busca) ||
      normalizeTextKey(s.login_rede || "").includes(busca) ||
      normalizeTextKey(s.email_institucional || "").includes(busca);
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
            <label class="block text-slate-400 mb-1">Matrícula Funcional *</label>
            <input type="text" id="srv-matricula" required placeholder="Ex: 25489" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">CPF</label>
            <input type="text" id="srv-cpf" placeholder="000.000.000-00" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Nome Completo *</label>
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
            <label class="block text-slate-400 mb-1">Login de Rede</label>
            <input type="text" id="srv-login" placeholder="nome.sobrenome" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">E-mail Institucional <span class="text-slate-500 text-[10px]">(opcional)</span></label>
            <input type="email" id="srv-email" placeholder="usuario.xyz@pf.gov.br" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
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
      cpf: document.getElementById("srv-cpf").value.trim() || null,
      nome_completo: document.getElementById("srv-nome").value.trim().toUpperCase(),
      nome_guerra: document.getElementById("srv-guerra").value.trim().toUpperCase() || null,
      cargo_sigla: document.getElementById("srv-cargo").value,
      unidade_sigla: document.getElementById("srv-unidade").value,
      login_rede: document.getElementById("srv-login").value.trim() || null,
      email_institucional: document.getElementById("srv-email").value.trim().toLowerCase() || null,
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
// 6. EXPORTAÇÃO DE DADOS (COM AUTHORIZATION BEARER)
// ==============================================================================
async function downloadExport(url, defaultFilename) {
  const token = localStorage.getItem("token");
  try {
    const response = await fetch(`${API_BASE}${url}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (response.status === 401) {
      logout();
      throw new Error("Sessão expirada. Faça login novamente.");
    }
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || `Erro HTTP ${response.status}`);
    }

    const disp = response.headers.get("content-disposition") || "";
    const match = disp.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
    const filename = match ? match[1].replace(/['"]/g, "") : defaultFilename;

    const blob = await response.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
  } catch (err) {
    alert(`Erro ao exportar arquivo: ${err.message}`);
  }
}

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
            <button type="button" onclick="downloadExport('/api/export/missoes.xlsx', 'relatorio_missoes_pf.xlsx')" class="mt-4 w-full text-center py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition">
              Baixar .XLSX
            </button>
          </div>

          <div class="bg-slate-900 border border-slate-800 hover:border-blue-500/50 p-5 rounded-2xl flex flex-col justify-between transition">
            <div>
              <div class="w-10 h-10 rounded-xl bg-blue-950 border border-blue-700/50 flex items-center justify-center text-blue-400 mb-3">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </div>
              <h4 class="font-bold text-white text-sm">Arquivo CSV (.csv)</h4>
              <p class="text-xs text-slate-400 mt-1">Exportação UTF-8 com BOM para importação rápida em planilhas.</p>
            </div>
            <button type="button" onclick="downloadExport('/api/export/missoes.csv', 'missoes_pf.csv')" class="mt-4 w-full text-center py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition">
              Baixar .CSV
            </button>
          </div>

          <div class="bg-slate-900 border border-slate-800 hover:border-amber-500/50 p-5 rounded-2xl flex flex-col justify-between transition">
            <div>
              <div class="w-10 h-10 rounded-xl bg-amber-950 border border-amber-700/50 flex items-center justify-center text-amber-400 mb-3">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
              </div>
              <h4 class="font-bold text-white text-sm">JSON Canônico</h4>
              <p class="text-xs text-slate-400 mt-1">Payload estruturado com metadados para auditoria e SEI/SCDP.</p>
            </div>
            <button type="button" onclick="downloadExport('/api/export/missoes.json', 'missoes_pf.json')" class="mt-4 w-full text-center py-2 bg-pf-gold hover:bg-yellow-400 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition">
              Baixar .JSON
            </button>
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
  if (!CURRENT_USER || !["ADMIN", "GESTOR_NAC", "GERENCIAL"].includes(CURRENT_USER.role)) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Acesso restrito a perfis Administrador, Gestor Nacional ou Gerencial.</div>`;
    return;
  }

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

          <!-- Filtros de Auditoria (Códigos reais da tabela audit_logs) -->
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
                <option value="CREATE">CREATE (Criação de Registro)</option>
                <option value="UPDATE">UPDATE (Atualização de Registro)</option>
                <option value="STATUS_CHANGE">STATUS_CHANGE (Alteração de Status)</option>
                <option value="UPDATE_VALOR_DIARIA">UPDATE_VALOR_DIARIA (Alteração de Diária)</option>
                <option value="ADD_PARTICIPANT">ADD_PARTICIPANT (Inclusão de Participante)</option>
                <option value="UPDATE_PARTICIPANT">UPDATE_PARTICIPANT (Edição de Participante)</option>
                <option value="REMOVE_PARTICIPANT">REMOVE_PARTICIPANT (Remoção de Participante)</option>
                <option value="CANCEL">CANCEL (Cancelamento)</option>
                <option value="DELETE">DELETE (Exclusão)</option>
                <option value="DEACTIVATE">DEACTIVATE (Desativação)</option>
                <option value="UPDATE_CONFIG">UPDATE_CONFIG (Configuração)</option>
                <option value="PASSWORD_RESET">PASSWORD_RESET (Redefinição de Senha)</option>
              </select>
            </div>
            <div>
              <input type="date" id="filtro-audit-data" class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white" title="Filtrar por data específica">
            </div>
          </div>
          <div class="flex justify-end pt-1">
            <button id="btn-limpar-filtros-audit" type="button" class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition font-semibold">
              ✕ Limpar Filtros
            </button>
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
    document.getElementById("btn-limpar-filtros-audit")?.addEventListener("click", () => {
      document.getElementById("filtro-audit-busca").value = "";
      document.getElementById("filtro-audit-op").value = "";
      document.getElementById("filtro-audit-data").value = "";
      applyAuditoriaFilter(logs);
    });

  } catch (err) {
    container.innerHTML = renderApiErrorBox("Erro ao carregar auditoria", err, "navigate('auditoria')");
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

  CURRENT_LOGS_CACHE = filtered;
  document.getElementById("auditoria-tbody").innerHTML = renderAuditoriaRows(filtered);
}

function openAuditDetail(logIndex) {
  const log = CURRENT_LOGS_CACHE[logIndex];
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
          <div class="flex justify-end pt-1">
            <button id="btn-limpar-filtros-usr" type="button" class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition font-semibold">
              ✕ Limpar Filtros
            </button>
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
    document.getElementById("btn-limpar-filtros-usr")?.addEventListener("click", () => {
      document.getElementById("filtro-usr-busca").value = "";
      document.getElementById("filtro-usr-role").value = "";
      document.getElementById("filtro-usr-status").value = "";
      applyUsuariosFilter(usuarios);
    });

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
        <h2 class="text-base font-bold text-white">Cadastrar Novo Usuário do Sistema</h2>
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
          <div class="flex items-center gap-2">
            <select id="filtro-unid-status" class="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-300">
              <option value="">Todos os Status</option>
              <option value="true" selected>Apenas Ativas</option>
              <option value="false">Apenas Inativas</option>
            </select>
            <button id="btn-limpar-filtros-unid" type="button" class="text-xs px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition font-semibold">
              ✕ Limpar Filtros
            </button>
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
                  <th class="py-3 px-3">Valor Diária</th>
                  <th class="py-3 px-3">Categoria</th>
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
    document.getElementById("btn-limpar-filtros-unid")?.addEventListener("click", () => {
      const b = document.getElementById("filtro-unid-busca");
      const uf = document.getElementById("filtro-unid-uf");
      const st = document.getElementById("filtro-unid-status");
      if (b) b.value = "";
      if (uf) uf.value = "";
      if (st) st.value = "";
      triggerFilter();
    });
    triggerFilter();
  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao carregar unidades: ${err.message}</div>`;
  }
}

function renderUnidadesRows(unidades) {
  if (!unidades || unidades.length === 0) {
    return `<tr><td colspan="8" class="py-8 text-center text-slate-400">Nenhuma unidade encontrada.</td></tr>`;
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
        <td class="py-3 px-3 font-mono font-bold text-amber-300">R$ ${(u.valor_diaria || 380).toFixed(2)}</td>
        <td class="py-3 px-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900 border border-slate-700 text-slate-300">
            ${u.categoria_diaria || 'CAPITAIS'}
          </span>
        </td>
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

function aoMudarCategoriaUnidade(catSelectId, diariaInputId, tipoSelectId) {
  const cat = document.getElementById(catSelectId)?.value;
  const inputDiaria = document.getElementById(diariaInputId);
  const selectTipo = document.getElementById(tipoSelectId);
  if (!inputDiaria) return;
  if (cat === "INTERIOR") {
    inputDiaria.value = "335.00";
    if (selectTipo) selectTipo.value = "DELEGACIA";
  } else if (cat === "CAPITAIS_ESPECIAIS") {
    inputDiaria.value = "425.00";
  } else {
    inputDiaria.value = "380.00";
    if (selectTipo) selectTipo.value = "SUPERINTENDENCIA";
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

          <!-- CATEGORIA E VALOR DA DIÁRIA CONFORME REQUISITOS OFICIAIS -->
          <div>
            <label class="block text-slate-400 mb-1">Categoria de Diária (Tabela Federal)</label>
            <select id="unid-categoria" onchange="aoMudarCategoriaUnidade('unid-categoria', 'unid-diaria', 'unid-tipo')" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
              <option value="INTERIOR">Interior do País (R$ 335,00)</option>
              <option value="CAPITAIS" selected>Capitais dos Estados (R$ 380,00)</option>
              <option value="CAPITAIS_ESPECIAIS">Capitais DF, RJ, SP, AM / Brasília (R$ 425,00)</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Valor da Diária Desta Unidade (R$)</label>
            <input type="number" id="unid-diaria" step="0.50" value="380.00" required class="w-full bg-slate-900 border border-pf-gold rounded-lg p-2 text-amber-300 font-bold">
          </div>
          <div class="md:col-span-2">
            <label class="block text-slate-400 mb-1">Tipo de Unidade Operacional</label>
            <select id="unid-tipo" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              <option value="SUPERINTENDENCIA" selected>Superintendência Regional (SR)</option>
              <option value="DELEGACIA">Delegacia (DPF)</option>
              <option value="DIRETORIA_DIVISAO">Diretoria / Divisão (Brasília)</option>
            </select>
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
      valor_diaria: parseFloat(document.getElementById("unid-diaria").value || 380),
      categoria_diaria: document.getElementById("unid-categoria").value,
      tipo_unidade: document.getElementById("unid-tipo").value,
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

          <!-- CATEGORIA E VALOR DA DIÁRIA DA UNIDADE -->
          <div>
            <label class="block text-slate-400 mb-1">Categoria de Diária (Tabela Federal)</label>
            <select id="edit-unid-categoria" onchange="aoMudarCategoriaUnidade('edit-unid-categoria', 'edit-unid-diaria', 'edit-unid-tipo')" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
              <option value="INTERIOR" ${u.categoria_diaria === 'INTERIOR' ? 'selected' : ''}>Interior do País (R$ 335,00)</option>
              <option value="CAPITAIS" ${(!u.categoria_diaria || u.categoria_diaria === 'CAPITAIS') ? 'selected' : ''}>Capitais dos Estados (R$ 380,00)</option>
              <option value="CAPITAIS_ESPECIAIS" ${u.categoria_diaria === 'CAPITAIS_ESPECIAIS' ? 'selected' : ''}>Capitais DF, RJ, SP, AM / Brasília (R$ 425,00)</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Valor da Diária Desta Unidade (R$)</label>
            <input type="number" id="edit-unid-diaria" step="0.50" value="${(u.valor_diaria || 380).toFixed(2)}" required class="w-full bg-slate-900 border border-pf-gold rounded-lg p-2 text-amber-300 font-bold">
          </div>
          <div class="md:col-span-2">
            <label class="block text-slate-400 mb-1">Tipo de Unidade Operacional</label>
            <select id="edit-unid-tipo" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              <option value="SUPERINTENDENCIA" ${u.tipo_unidade === 'SUPERINTENDENCIA' ? 'selected' : ''}>Superintendência Regional (SR)</option>
              <option value="DELEGACIA" ${u.tipo_unidade === 'DELEGACIA' ? 'selected' : ''}>Delegacia (DPF)</option>
              <option value="DIRETORIA_DIVISAO" ${u.tipo_unidade === 'DIRETORIA_DIVISAO' ? 'selected' : ''}>Diretoria / Divisão (Brasília)</option>
            </select>
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
      valor_diaria: parseFloat(document.getElementById("edit-unid-diaria").value || 380),
      categoria_diaria: document.getElementById("edit-unid-categoria").value,
      tipo_unidade: document.getElementById("edit-unid-tipo").value,
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
    const [configs, valoresDiarias] = await Promise.all([
      apiFetch("/api/config"),
      apiFetch("/api/missoes/meta/valores-diarias").catch(() => [])
    ]);

    container.innerHTML = `
      <div class="max-w-3xl mx-auto space-y-6 animate-fade-in">
        <!-- 1. TABELA SEPARADA DE VALORES OFICIAIS DE DIÁRIAS (DECRETO/PORTARIA FEDERAL) -->
        <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div class="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
            <div>
              <div class="flex items-center space-x-2">
                <h3 class="text-base font-bold text-white">Tabela de Valores Oficiais de Diárias</h3>
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-pf-gold border border-amber-500/30">Tabela Federal Oficial</span>
              </div>
              <p class="text-xs text-slate-400 mt-0.5">3 faixas oficiais que determinam as diárias das unidades da Polícia Federal</p>
            </div>
          </div>

          <div class="space-y-3 text-xs">
            ${valoresDiarias.map(v => `
              <div class="bg-slate-900 p-4 rounded-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div class="space-y-0.5">
                  <div class="flex items-center space-x-2">
                    <span class="font-bold text-white font-mono text-sm">${v.categoria}</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">${v.id}</span>
                  </div>
                  <p class="text-slate-400 text-xs">${v.descricao}</p>
                </div>
                <div class="flex items-center space-x-2">
                  <span class="text-slate-400 text-xs font-semibold">R$</span>
                  <input type="number" step="0.50" id="val-diaria-${v.categoria}" value="${parseFloat(v.valor).toFixed(2)}"
                         class="w-28 bg-slate-950 border border-pf-gold rounded-lg px-3 py-1.5 text-xs text-amber-300 font-mono font-bold text-right">
                  <button onclick="salvarValorDiariaOficial('${v.categoria}')"
                          class="px-3 py-1.5 bg-pf-gold hover:bg-yellow-400 text-slate-950 rounded-lg font-bold text-xs transition shadow">
                    Atualizar
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 2. PARÂMETROS GERAIS DA PLATAFORMA -->
        <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h3 class="text-base font-bold text-white mb-1">Parâmetros Operacionais e Alertas</h3>
          <p class="text-xs text-slate-400 mb-6">Prazos de alertas de passagens aéreas e configurações institucionais</p>

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

async function salvarValorDiariaOficial(categoria) {
  const input = document.getElementById(`val-diaria-${categoria}`);
  const valor = parseFloat(input?.value || 0);
  if (!valor || valor <= 0) {
    alert("Informe um valor válido de diária.");
    return;
  }
  try {
    await apiFetch(`/api/missoes/meta/valores-diarias/${categoria}`, {
      method: "PUT",
      body: JSON.stringify({ valor })
    });
    alert(`Valor da categoria '${categoria}' atualizado com sucesso para R$ ${valor.toFixed(2)}! As unidades vinculadas foram atualizadas.`);
    METADATA_CACHE.unidades = await apiFetch("/api/missoes/meta/unidades");
    renderConfig(document.getElementById("view-container"));
  } catch (err) {
    alert(`Erro ao atualizar valor de diária: ${err.message}`);
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
