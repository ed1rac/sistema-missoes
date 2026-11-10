/**
 * SIS-MISSÕES PF - Frontend Application
 * Plataforma Corporativa de Controle de Missões e Servidores
 */

const API_BASE = "";
let CURRENT_USER = null;
let CURRENT_VIEW = "dashboard";
let SYSTEM_CONFIG = {};

// Utilitários de API
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

// Inicialização
document.addEventListener("DOMContentLoaded", async () => {
  setupLoginEvents();
  const token = localStorage.getItem("token");
  if (token) {
    try {
      CURRENT_USER = await apiFetch("/api/auth/me");
      updateUserInfo();
      await loadSystemConfig();
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

// Navegação entre Vistas
function navigate(viewName) {
  CURRENT_VIEW = viewName;
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
  const activeBtn = document.getElementById(`nav-${viewName}`);
  if (activeBtn) activeBtn.classList.add("active");

  const container = document.getElementById("view-container");
  const titles = {
    dashboard: "Painel Executivo de Missões",
    missoes: "Gestão Corporativa de Missões",
    servidores: "Cadastro Integrado de Servidores da PF",
    "diarias-calc": "Simulador Oficial de Diárias (Legislação PF)",
    exportar: "Módulo de Interoperabilidade e Exportação",
    auditoria: "Trilha Imutável de Auditoria (Compliance)",
    config: "Parâmetros Gerais do Sistema e Diária Base"
  };
  document.getElementById("page-title").textContent = titles[viewName] || "SIS-MISSÕES PF";

  switch (viewName) {
    case "dashboard":
      renderDashboard(container);
      break;
    case "missoes":
      renderMissoes(container);
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
    case "config":
      renderConfig(container);
      break;
    default:
      container.innerHTML = `<p class="text-slate-400">Página em construção.</p>`;
  }
}

// ==============================================================================
// 1. DASHBOARD
// ==============================================================================
async function renderDashboard(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando painel executivo...</div>`;
  try {
    const summary = await apiFetch("/api/dashboard/summary");
    const missoesRecentes = await apiFetch("/api/missoes");

    let alertsHtml = "";
    if (summary.alertas && summary.alertas.length > 0) {
      alertsHtml = `
        <div class="mb-6 space-y-2">
          ${summary.alertas.map(a => `
            <div class="p-4 rounded-xl border flex items-start space-x-3 ${a.tipo === 'PERIGO' ? 'bg-red-950/40 border-red-800/80 text-red-200' : 'bg-amber-950/40 border-amber-800/80 text-amber-200'}">
              <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              <div class="flex-1 text-xs">
                <span class="font-bold uppercase tracking-wider">${a.titulo}:</span>
                <span>${a.mensagem}</span>
              </div>
              ${a.missao_codigo ? `<button onclick="openMissaoDetail('${a.missao_codigo}')" class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-white transition">Ver Missão</button>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    container.innerHTML = `
      <div class="space-y-6 animate-fade-in">
        ${alertsHtml}

        <!-- KPI Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-slate-950/60 border border-slate-800 p-5 rounded-2xl relative overflow-hidden">
            <div class="absolute -right-2 -bottom-2 opacity-10 text-pf-gold">
              <svg class="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            </div>
            <p class="text-xs font-semibold uppercase text-slate-400">Total de Missões</p>
            <p class="text-3xl font-extrabold text-white mt-2">${summary.total_missoes}</p>
            <div class="flex items-center space-x-2 mt-2 text-xs">
              <span class="text-emerald-400 font-bold">${summary.missoes_em_andamento} em andamento</span>
              <span class="text-slate-500">•</span>
              <span class="text-slate-400">${summary.missoes_planejamento} em tramitação</span>
            </div>
          </div>

          <div class="bg-slate-950/60 border border-slate-800 p-5 rounded-2xl relative overflow-hidden">
            <div class="absolute -right-2 -bottom-2 opacity-10 text-blue-400">
              <svg class="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
            </div>
            <p class="text-xs font-semibold uppercase text-slate-400">Efetivo Policial em Campo</p>
            <p class="text-3xl font-extrabold text-blue-400 mt-2">${summary.total_servidores_em_missao}</p>
            <p class="text-xs text-slate-400 mt-2">de ${summary.total_servidores_ativos} servidores ativos</p>
          </div>

          <div class="bg-slate-950/60 border border-slate-800 p-5 rounded-2xl relative overflow-hidden">
            <div class="absolute -right-2 -bottom-2 opacity-10 text-amber-400">
              <svg class="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <p class="text-xs font-semibold uppercase text-slate-400">Total em Diárias Pagas/Previstas</p>
            <p class="text-2xl font-bold text-amber-400 mt-2">${formatMoney(summary.custo_total_diarias)}</p>
            <p class="text-xs text-slate-400 mt-2">Diária Base: <span class="font-semibold text-pf-gold">${formatMoney(summary.valor_diaria_padrao_sistema)}</span></p>
          </div>

          <div class="bg-slate-950/60 border border-slate-800 p-5 rounded-2xl relative overflow-hidden">
            <div class="absolute -right-2 -bottom-2 opacity-10 text-emerald-400">
              <svg class="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
            </div>
            <p class="text-xs font-semibold uppercase text-slate-400">Custo Geral Consolidado</p>
            <p class="text-2xl font-bold text-emerald-400 mt-2">${formatMoney(summary.custo_total_geral)}</p>
            <p class="text-xs text-slate-400 mt-2">Passagens Aéreas: ${formatMoney(summary.custo_total_passagens)}</p>
          </div>
        </div>

        <!-- Recent Missions Section -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-6">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h3 class="text-base font-bold text-white">Missões Institucionais Recentes</h3>
              <p class="text-xs text-slate-400">Acompanhamento operacional e financeiro consolidado</p>
            </div>
            <button onclick="navigate('missoes')" class="text-xs font-semibold text-pf-gold hover:underline">
              Ver Todas as Missões &rarr;
            </button>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[11px]">
                <tr>
                  <th class="py-3 px-3">Código</th>
                  <th class="py-3 px-3">Título da Missão</th>
                  <th class="py-3 px-3">Tipo</th>
                  <th class="py-3 px-3">Período</th>
                  <th class="py-3 px-3">Status</th>
                  <th class="py-3 px-3">Diária Base</th>
                  <th class="py-3 px-3">Efetivo</th>
                  <th class="py-3 px-3">Custo Total</th>
                  <th class="py-3 px-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                ${missoesRecentes.slice(0, 5).map(m => `
                  <tr class="hover:bg-slate-800/40 transition">
                    <td class="py-3 px-3 font-mono font-bold text-pf-gold">${m.codigo_missao}</td>
                    <td class="py-3 px-3 font-medium text-white max-w-xs truncate">${m.titulo}</td>
                    <td class="py-3 px-3 text-slate-300">${m.tipo_missao}</td>
                    <td class="py-3 px-3 text-slate-400">${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)} (${m.total_dias}d)</td>
                    <td class="py-3 px-3">
                      <span class="badge-status badge-${m.status_atual}">${m.status_atual.replace('_', ' ')}</span>
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
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao carregar dashboard: ${err.message}</div>`;
  }
}

// ==============================================================================
// 2. GESTÃO DE MISSÕES
// ==============================================================================
async function renderMissoes(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando missões...</div>`;
  try {
    const missoes = await apiFetch("/api/missoes");
    const tipos = await apiFetch("/api/missoes/meta/tipos");

    container.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <!-- Action / Filter Bar -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center space-x-3 flex-1 min-w-[280px]">
            <input type="text" id="filtro-busca" placeholder="Buscar por código, título, cidade, OM..."
                   class="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-pf-gold">
            <select id="filtro-status" class="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none">
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
          <button onclick="openModalNovaMissao()" class="bg-gradient-to-r from-pf-gold to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow-lg flex items-center space-x-2 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            <span>Nova Missão</span>
          </button>
        </div>

        <!-- Table -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs" id="tabela-missoes">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[11px]">
                <tr>
                  <th class="py-3 px-3">Código</th>
                  <th class="py-3 px-3">Título</th>
                  <th class="py-3 px-3">Origem / Destino</th>
                  <th class="py-3 px-3">Período</th>
                  <th class="py-3 px-3">Status</th>
                  <th class="py-3 px-3">Diária Base (Editável)</th>
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

    // Filter listeners
    document.getElementById("filtro-busca").addEventListener("input", () => applyMissoesFilter(missoes));
    document.getElementById("filtro-status").addEventListener("change", () => applyMissoesFilter(missoes));
  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao listar missões: ${err.message}</div>`;
  }
}

function renderMissoesRows(list) {
  if (list.length === 0) {
    return `<tr><td colspan="9" class="text-center py-8 text-slate-500">Nenhuma missão encontrada com os filtros aplicados.</td></tr>`;
  }
  return list.map(m => `
    <tr class="hover:bg-slate-800/40 transition">
      <td class="py-3 px-3 font-mono font-bold text-pf-gold">${m.codigo_missao}</td>
      <td class="py-3 px-3 font-semibold text-white max-w-xs truncate">${m.titulo}</td>
      <td class="py-3 px-3 text-slate-300">${m.unidade_solicitante} &rarr; ${m.unidade_destino || m.localidade_descricao}</td>
      <td class="py-3 px-3 text-slate-400">${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)} (${m.total_dias}d)</td>
      <td class="py-3 px-3">
        <span class="badge-status badge-${m.status_atual}">${m.status_atual.replace('_', ' ')}</span>
      </td>
      <td class="py-3 px-3 font-bold text-amber-300">
        <span class="bg-amber-950/40 border border-amber-800/60 px-2 py-0.5 rounded text-[11px]">
          ${formatMoney(m.valor_diaria_padrao)}
        </span>
      </td>
      <td class="py-3 px-3 text-slate-300">${m.total_participantes} servidores</td>
      <td class="py-3 px-3 font-bold text-emerald-400">${formatMoney(m.total_custo_geral)}</td>
      <td class="py-3 px-3 text-right space-x-1">
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

  const filtered = allMissions.filter(m => {
    const matchBusca = !busca || 
      m.codigo_missao.toLowerCase().includes(busca) ||
      m.titulo.toLowerCase().includes(busca) ||
      m.localidade_descricao.toLowerCase().includes(busca) ||
      (m.numero_om && m.numero_om.toLowerCase().includes(busca));
    const matchStatus = !status || m.status_atual === status;
    return matchBusca && matchStatus;
  });

  document.getElementById("missoes-tbody").innerHTML = renderMissoesRows(filtered);
}

// ==============================================================================
// 3. DETALHE / GESTÃO COMPLETA DA MISSÃO (COM CAMPO EDITÁVEL DA DIÁRIA)
// ==============================================================================
async function openMissaoDetail(codigoOuId) {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContent.innerHTML = `<div class="p-8 text-center text-slate-400">Carregando detalhes da missão...</div>`;
  modalContainer.classList.remove("hidden");

  try {
    const m = await apiFetch(`/api/missoes/${codigoOuId}`);
    const servidores = await apiFetch("/api/servidores?ativo=true");
    const papeis = await apiFetch("/api/missoes/meta/papeis");

    modalContent.innerHTML = `
      <div class="space-y-6">
        <!-- Modal Header -->
        <div class="flex items-start justify-between border-b border-slate-800 pb-4">
          <div>
            <div class="flex items-center space-x-3">
              <span class="font-mono text-xl font-bold text-pf-gold">${m.codigo_missao}</span>
              <span class="badge-status badge-${m.status_atual}">${m.status_atual.replace('_', ' ')}</span>
            </div>
            <h2 class="text-lg font-bold text-white mt-1">${m.titulo}</h2>
            <p class="text-xs text-slate-400 mt-0.5">${m.tipo_missao} • Solicitante: <strong class="text-slate-200">${m.unidade_solicitante}</strong> • Destino: <strong class="text-slate-200">${m.unidade_destino || m.localidade_descricao}</strong></p>
          </div>
          <button onclick="closeModal()" class="text-slate-400 hover:text-white p-1 rounded-lg">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <!-- Administrative Details & Workflow Status -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3 bg-slate-950/80 p-4 rounded-xl border border-slate-800 text-xs">
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">Período Oficial</p>
            <p class="font-bold text-white mt-0.5">${formatDateBR(m.data_inicio)} a ${formatDateBR(m.data_termino)} (${m.total_dias} dias)</p>
          </div>
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">Ordem de Missão (OM)</p>
            <p class="font-mono text-slate-200 mt-0.5">${m.numero_om || 'Não emitida'}</p>
          </div>
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">PCDP (SCDP)</p>
            <p class="font-mono ${m.numero_pcdp ? 'text-emerald-400 font-bold' : 'text-amber-400 font-semibold'} mt-0.5">${m.numero_pcdp || 'Pendente de Lançamento'}</p>
          </div>
          <div>
            <p class="text-slate-500 uppercase font-semibold text-[10px]">Processo SEI</p>
            <p class="font-mono text-slate-200 mt-0.5">${m.processo_sei || '-'}</p>
          </div>
        </div>

        <!-- CAMPO EDITÁVEL DO VALOR DA DIÁRIA DA MISSÃO COM RECALCULO DINÂMICO -->
        <div class="bg-gradient-to-r from-pf-900/60 to-slate-950 border border-pf-gold/50 rounded-2xl p-5 shadow-lg">
          <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div class="flex items-center space-x-2">
                <svg class="w-5 h-5 text-pf-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <h3 class="text-sm font-bold text-white uppercase tracking-wider">Campo Editável da Diária da Missão</h3>
              </div>
              <p class="text-xs text-slate-300 mt-1">Altere o valor unitário da diária desta missão. Todos os participantes serão recalculados automaticamente!</p>
            </div>

            <div class="flex items-center space-x-2">
              <div class="relative">
                <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-xs text-slate-400 font-bold">R$</span>
                <input type="number" id="input-diaria-missao" step="0.50" min="0" value="${m.valor_diaria_padrao}"
                       class="w-32 bg-slate-900 border-2 border-pf-gold rounded-xl pl-8 pr-3 py-2 text-sm font-extrabold text-amber-300 focus:outline-none focus:ring-2 focus:ring-yellow-400">
              </div>
              <button onclick="salvarNovoValorDiaria('${m.id}')"
                      class="bg-pf-gold hover:bg-yellow-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow transition flex items-center space-x-1">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                <span>Recalcular Diárias</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Workflow State Progression -->
        <div class="flex flex-wrap items-center justify-between gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
          <span class="text-xs text-slate-400 font-semibold uppercase">Transição de Ciclo de Vida:</span>
          <div class="flex flex-wrap gap-2">
            ${m.status_atual === 'RASCUNHO' ? `<button onclick="mudarStatusMissao('${m.id}', 'SOLICITADA')" class="px-3 py-1 bg-amber-700 hover:bg-amber-600 text-white rounded-lg text-xs font-semibold">Submeter Solicitação</button>` : ''}
            ${m.status_atual === 'SOLICITADA' ? `<button onclick="mudarStatusMissao('${m.id}', 'APROVADA')" class="px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold">Aprovar Missão</button>` : ''}
            ${m.status_atual === 'APROVADA' ? `<button onclick="mudarStatusMissao('${m.id}', 'OM_EMITIDA')" class="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-xs font-semibold">Emitir Ordem de Missão (OM)</button>` : ''}
            ${m.status_atual === 'OM_EMITIDA' ? `<button onclick="mudarStatusMissao('${m.id}', 'PCDP_TRAMITADA')" class="px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white rounded-lg text-xs font-semibold">Homologar PCDP</button>` : ''}
            ${m.status_atual === 'PCDP_TRAMITADA' ? `<button onclick="mudarStatusMissao('${m.id}', 'EM_ANDAMENTO')" class="px-3 py-1 bg-teal-700 hover:bg-teal-600 text-white rounded-lg text-xs font-semibold">Iniciar Missão</button>` : ''}
            ${m.status_atual === 'EM_ANDAMENTO' ? `<button onclick="mudarStatusMissao('${m.id}', 'PRESTACAO_CONTAS')" class="px-3 py-1 bg-orange-700 hover:bg-orange-600 text-white rounded-lg text-xs font-semibold">Finalizar e Prestar Contas</button>` : ''}
            ${m.status_atual === 'PRESTACAO_CONTAS' ? `<button onclick="mudarStatusMissao('${m.id}', 'CONCLUIDA')" class="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded-lg text-xs font-semibold">Homologar e Concluir</button>` : ''}
            ${m.status_atual !== 'CANCELADA' && m.status_atual !== 'CONCLUIDA' ? `<button onclick="mudarStatusMissao('${m.id}', 'CANCELADA')" class="px-3 py-1 bg-red-900/60 hover:bg-red-800 text-red-200 rounded-lg text-xs font-semibold">Cancelar Missão</button>` : ''}
          </div>
        </div>

        <!-- Participants / Personnel Designated -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-white uppercase tracking-wider">Servidores Designados (${m.participantes.length})</h3>
              <p class="text-xs text-slate-400">Relação N:M de servidores, transporte, cálculo de diárias e bilhetes</p>
            </div>
            <button onclick="toggleFormNovoParticipante()" class="bg-pf-700 hover:bg-pf-600 text-white font-bold px-3 py-1.5 rounded-xl text-xs uppercase tracking-wider transition flex items-center space-x-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>
              <span>Adicionar Servidor</span>
            </button>
          </div>

          <!-- Add Participant Form (collapsible) -->
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
          <div class="overflow-x-auto bg-slate-950/80 rounded-xl border border-slate-800">
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
                  <th class="py-2.5 px-3 text-right">Ação</th>
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
                    <td class="py-3 px-3 text-right">
                      <button onclick="removerParticipante('${m.id}', '${p.id}')" class="p-1 text-slate-500 hover:text-red-400 rounded transition" title="Remover participante">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                      </button>
                    </td>
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

function closeModal() {
  document.getElementById("modal-container").classList.add("hidden");
}

function toggleFormNovoParticipante() {
  const el = document.getElementById("form-novo-participante");
  el.classList.toggle("hidden");
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

// Modal Nova Missão
async function openModalNovaMissao() {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContainer.classList.remove("hidden");

  const unidades = await apiFetch("/api/missoes/meta/unidades");
  const tipos = await apiFetch("/api/missoes/meta/tipos");
  const servidores = await apiFetch("/api/servidores?ativo=true");
  const diariaBase = SYSTEM_CONFIG.valor_diaria_padrao || "425.00";

  const proxCod = `MIS-2026-00${Math.floor(Math.random() * 900 + 100)}`;

  modalContent.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 class="text-base font-bold text-white">Abertura de Nova Missão Institucional</h2>
        <button onclick="closeModal()" class="text-slate-400 hover:text-white">&times;</button>
      </div>

      <form id="form-criar-missao" class="space-y-3 text-xs">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label class="block text-slate-400 mb-1">Código da Missão</label>
            <input type="text" id="nova-codigo" value="${proxCod}" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono font-bold text-pf-gold">
          </div>
          <div class="md:col-span-2">
            <label class="block text-slate-400 mb-1">Título da Missão</label>
            <input type="text" id="nova-titulo" placeholder="Ex: Operação Fronteira Segura 2026" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-semibold">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Tipo de Missão</label>
            <select id="nova-tipo" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              ${tipos.map(t => `<option value="${t.nome}">${t.nome}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Unidade Solicitante</label>
            <select id="nova-solicitante" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              ${unidades.map(u => `<option value="${u.sigla}">${u.sigla} - ${u.nome_extenso}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Unidade de Destino</label>
            <select id="nova-destino" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              <option value="">Nenhuma / Área Externa</option>
              ${unidades.map(u => `<option value="${u.sigla}">${u.sigla} - ${u.nome_extenso}</option>`).join('')}
            </select>
          </div>
          <div class="md:col-span-3">
            <label class="block text-slate-400 mb-1">Localidade de Execução</label>
            <input type="text" id="nova-localidade" placeholder="Ex: Academia Nacional de Polícia, Brasília/DF" required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
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
            <label class="block text-slate-400 mb-1">Valor Diária Base desta Missão (R$)</label>
            <input type="number" id="nova-diaria-padrao" step="0.50" value="${diariaBase}" required class="w-full bg-slate-900 border-2 border-pf-gold rounded-lg p-2 text-amber-300 font-extrabold">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Chefe da Equipe (Responsável)</label>
            <select id="nova-responsavel" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
              <option value="">Selecione...</option>
              ${servidores.map(s => `<option value="${s.matricula}">[${s.cargo_sigla}] ${s.nome_completo}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Processo SEI</label>
            <input type="text" id="nova-sei" placeholder="08200.000000/2026-00" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div>
            <label class="block text-slate-400 mb-1">Nº Solicitação SAT</label>
            <input type="text" id="nova-sat" placeholder="SAT-2026-0000" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white font-mono">
          </div>
          <div class="md:col-span-3">
            <label class="block text-slate-400 mb-1">Justificativa da Missão</label>
            <textarea id="nova-justificativa" rows="2" placeholder="Fundamentação e interesse público..." required class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white"></textarea>
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
    const payload = {
      codigo_missao: document.getElementById("nova-codigo").value.trim(),
      titulo: document.getElementById("nova-titulo").value.trim(),
      tipo_missao: document.getElementById("nova-tipo").value,
      unidade_solicitante: document.getElementById("nova-solicitante").value,
      unidade_destino: document.getElementById("nova-destino").value || null,
      localidade_descricao: document.getElementById("nova-localidade").value.trim(),
      data_inicio: document.getElementById("nova-dt-inicio").value,
      data_termino: document.getElementById("nova-dt-termino").value,
      valor_diaria_padrao: parseFloat(document.getElementById("nova-diaria-padrao").value || 425),
      responsavel_matricula: document.getElementById("nova-responsavel").value || null,
      processo_sei: document.getElementById("nova-sei").value.trim() || null,
      numero_sat: document.getElementById("nova-sat").value.trim() || null,
      justificativa: document.getElementById("nova-justificativa").value.trim(),
      status_atual: "RASCUNHO"
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

// ==============================================================================
// 4. CADASTRO DE SERVIDORES (TRANSIÇÃO DO "INSTRUTOR" PARA "SERVIDOR")
// ==============================================================================
async function renderServidores(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando servidores da Polícia Federal...</div>`;
  try {
    const servidores = await apiFetch("/api/servidores");
    const cargos = await apiFetch("/api/missoes/meta/cargos");
    const unidades = await apiFetch("/api/missoes/meta/unidades");

    container.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <!-- Header Info -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 class="text-sm font-bold text-white uppercase tracking-wider">Efetivo Policial e Administrativo</h3>
            <p class="text-xs text-slate-400">Novo paradigma: servidores com papéis dinâmicos (docente, perito, operador tático)</p>
          </div>
          <button onclick="openModalNovoServidor()" class="bg-pf-700 hover:bg-pf-600 text-white font-bold px-4 py-2 rounded-xl text-xs uppercase tracking-wider shadow flex items-center space-x-1.5 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            <span>Novo Servidor</span>
          </button>
        </div>

        <!-- Table -->
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
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
              <tbody class="divide-y divide-slate-800/60">
                ${servidores.map(s => `
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
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao listar servidores: ${err.message}</div>`;
  }
}

async function openModalNovoServidor() {
  const modalContainer = document.getElementById("modal-container");
  const modalContent = document.getElementById("modal-content");
  modalContainer.classList.remove("hidden");

  const cargos = await apiFetch("/api/missoes/meta/cargos");
  const unidades = await apiFetch("/api/missoes/meta/unidades");

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
            <label class="block text-slate-400 mb-1">Unidade de Lotação</label>
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
            <input type="text" id="srv-telefone" placeholder="(61) 99999-9999" class="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-white">
          </div>
          <div class="flex items-center space-x-4 pt-4">
            <label class="flex items-center space-x-1.5 cursor-pointer">
              <input type="checkbox" id="srv-tpe" class="rounded bg-slate-900 border-slate-700 text-pf-gold focus:ring-0">
              <span class="text-slate-300">Possui TPE (Instrutor ANP)</span>
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
// 5. SIMULADOR E CALCULADORA DE DIÁRIAS (REGRAS DA POLÍCIA FEDERAL)
// ==============================================================================
function renderDiariasCalculator(container) {
  const diariaBase = SYSTEM_CONFIG.valor_diaria_padrao || "425.00";
  container.innerHTML = `
    <div class="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div class="bg-slate-950/80 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <h3 class="text-base font-bold text-white mb-1">Simulador de Diárias Oficiais da Polícia Federal</h3>
        <p class="text-xs text-slate-400 mb-6">Fórmula: <code class="bg-slate-900 px-2 py-1 rounded text-pf-gold font-mono font-bold">(dias - 0,5) × valor_diaria</code> com isenção total para lotação na sede da missão.</p>

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
              <p class="text-[11px] text-slate-400">Ex: Servidor de Brasília atuando na Academia Nacional de Polícia (ANP/DF).</p>
            </div>
          </div>

          <button onclick="executarCalculoSimulador()" class="w-full bg-gradient-to-r from-pf-gold to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-slate-950 font-bold py-3 rounded-xl uppercase tracking-wider shadow-lg transition">
            Calcular Diárias e Custo
          </button>
        </div>

        <!-- Output Box -->
        <div id="calc-resultado" class="mt-6 p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-3">
          <!-- Live result injected here -->
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
          <p class="text-xs text-slate-400 mt-1">Gere relatórios executivos e datasets tabulares em tempo real nos formatos institucionais.</p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <!-- Excel -->
          <div class="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 p-5 rounded-2xl flex flex-col justify-between transition">
            <div>
              <div class="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-700/50 flex items-center justify-center text-emerald-400 mb-3">
                <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm1 8h-4v2h4v-2zm-4 4h4v-2h-4v2zm-2-4H7v2h2v-2zm-2 4h2v-2H7v2zm8 4h-4v2h4v-2zm-4-6h4v-2h-4v2z"/></svg>
              </div>
              <h4 class="font-bold text-white text-sm">Planilha Excel (.xlsx)</h4>
              <p class="text-xs text-slate-400 mt-1">Relatório multiabas estilizado com cabeçalhos institucionais, custos e bilhetes.</p>
            </div>
            <a href="/api/export/missoes.xlsx" target="_blank" class="mt-4 w-full text-center py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition">
              Baixar .XLSX
            </a>
          </div>

          <!-- CSV -->
          <div class="bg-slate-900 border border-slate-800 hover:border-blue-500/50 p-5 rounded-2xl flex flex-col justify-between transition">
            <div>
              <div class="w-10 h-10 rounded-xl bg-blue-950 border border-blue-700/50 flex items-center justify-center text-blue-400 mb-3">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              </div>
              <h4 class="font-bold text-white text-sm">Arquivo CSV (.csv)</h4>
              <p class="text-xs text-slate-400 mt-1">Exportação delimitada com codificação UTF-8 com BOM para importação direta no Excel.</p>
            </div>
            <a href="/api/export/missoes.csv" target="_blank" class="mt-4 w-full text-center py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition">
              Baixar .CSV
            </a>
          </div>

          <!-- JSON -->
          <div class="bg-slate-900 border border-slate-800 hover:border-amber-500/50 p-5 rounded-2xl flex flex-col justify-between transition">
            <div>
              <div class="w-10 h-10 rounded-xl bg-amber-950 border border-amber-700/50 flex items-center justify-center text-amber-400 mb-3">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
              </div>
              <h4 class="font-bold text-white text-sm">JSON Canônico</h4>
              <p class="text-xs text-slate-400 mt-1">Exportação estruturada para integração com barramentos SEI, SCDP e DGI.</p>
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
// 7. TRILHA DE AUDITORIA
// ==============================================================================
async function renderAuditoria(container) {
  container.innerHTML = `<div class="flex items-center justify-center p-12 text-slate-400">Carregando trilha de auditoria...</div>`;
  try {
    const logs = await apiFetch("/api/audit/logs");
    container.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
          <h3 class="text-sm font-bold text-white uppercase tracking-wider">Trilha Imutável de Auditoria (Compliance e LGPD)</h3>
          <p class="text-xs text-slate-400">Rastreamento de todas as alterações, autorizações, cadastros e atualizações de diárias</p>
        </div>

        <div class="bg-slate-950/60 border border-slate-800 rounded-2xl p-4">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="text-slate-400 border-b border-slate-800 uppercase font-semibold text-[11px]">
                <tr>
                  <th class="py-3 px-3">Data/Hora (UTC)</th>
                  <th class="py-3 px-3">Operador</th>
                  <th class="py-3 px-3">IP de Origem</th>
                  <th class="py-3 px-3">Operação</th>
                  <th class="py-3 px-3">Entidade Afetada</th>
                  <th class="py-3 px-3">Detalhes / Modificações</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60">
                ${logs.map(l => `
                  <tr class="hover:bg-slate-800/40 transition">
                    <td class="py-3 px-3 font-mono text-slate-400 whitespace-nowrap">${l.timestamp}</td>
                    <td class="py-3 px-3 font-bold text-white font-mono">${l.usuario_login}</td>
                    <td class="py-3 px-3 text-slate-400 font-mono">${l.usuario_ip}</td>
                    <td class="py-3 px-3">
                      <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 border border-slate-700 text-blue-300">
                        ${l.operacao}
                      </span>
                    </td>
                    <td class="py-3 px-3 font-mono text-slate-300">${l.entidade_tabela}</td>
                    <td class="py-3 px-3 font-mono text-[11px] text-slate-400 max-w-md truncate">
                      ${l.detalhes ? JSON.stringify(l.detalhes) : '-'}
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
    container.innerHTML = `<div class="p-6 bg-red-950/60 border border-red-800 rounded-xl text-red-200 text-xs">Erro ao carregar auditoria: ${err.message}</div>`;
  }
}

// ==============================================================================
// 8. PARÂMETROS GERAIS DO SISTEMA
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
