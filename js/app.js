/* ================================================
   PLANNIT — App Logic
   Planner pessoal de execução diária
   ================================================ */

'use strict';

// ══════════════════════════════════════════════
// CONSTANTES
// ══════════════════════════════════════════════

const STORAGE_KEY    = 'plannit_v1';
const SCHEMA_VERSION = 2;

// ── Chave da API Groq ──────────────────────────
// Gratuita em console.groq.com — sem cartão, sem faturamento
const GROQ_KEY = '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';

const DIAS_CURTO  = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];
const MESES_CURTO = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const MESES_FULL  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const STATUS_LABELS = {
  normal:      'DIA NORMAL',
  acao:        'AÇÃO & FOCO',
  compromisso: 'COMPROMISSO',
  cansativo:   'CANSATIVO',
  relaxar:     'RELAXAR',
  neutro:      'NEUTRO'
};

// Ciclo de status ao clicar na pill
const STATUS_CYCLE = [null, 'normal', 'acao', 'compromisso', 'cansativo', 'relaxar', 'neutro'];

// ══════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════

let currentDate = todayString();   // "YYYY-MM-DD" do dia sendo visualizado
let currentView = 'today';         // 'today' | 'plan' | 'backlog' | 'retro' | 'metas'
let appData = { days: {}, backlog: [], metas: [] };

// Estado do calendário (aba Planejar)
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0–11

// Estado do formulário de metas
let _metaAlvo = 5;

// ── Filtros de listagens ──
let _backlogFiltro = 'todas';   // 'todas' | 'unicas' | 'recorrentes'
let _retroFiltro   = '7';       // '7' | '30' | 'todos'
let _metasFiltro   = 'todas';   // 'todas' | 'manual' | 'auto'

// ── Toast ──
let _toastTimer = null;

// ══════════════════════════════════════════════
// HELPERS DE DATA
// ══════════════════════════════════════════════

/** Retorna "YYYY-MM-DD" de hoje */
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

/** Adiciona zero à esquerda */
function pad(n) { return String(n).padStart(2, '0'); }

/** Parseia "YYYY-MM-DD" para Date local (sem UTC shift) */
function parseLocal(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "SEG, 12 ABR" */
function formatShort(str) {
  const d = parseLocal(str);
  return `${DIAS_CURTO[d.getDay()]}, ${pad(d.getDate())} ${MESES_CURTO[d.getMonth()]}`;
}

/** "12 de Abril" */
function formatMedium(str) {
  const d = parseLocal(str);
  return `${d.getDate()} de ${MESES_FULL[d.getMonth()]}`;
}

/** Adiciona N dias a "YYYY-MM-DD" */
function addDays(str, n) {
  const d = parseLocal(str);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function isToday(str) { return str === todayString(); }
function isPast(str)  { return str < todayString(); }

// ══════════════════════════════════════════════
// DADOS
// ══════════════════════════════════════════════

function defaultDay() {
  return {
    bigGoal: '',
    bigDone: false,
    medium: [
      { text: '', done: false },
      { text: '', done: false },
      { text: '', done: false }
    ],
    small: [
      { text: '', done: false },
      { text: '', done: false },
      { text: '', done: false },
      { text: '', done: false },
      { text: '', done: false }
    ],
    balance: { work: 8, personal: 8, sleep: 8 },
    captures: [],
    status: null
  };
}

function getDay(date) {
  if (!appData.days[date]) {
    appData.days[date] = defaultDay();
  }
  return appData.days[date];
}

function save() {
  const payload = { ...appData, _schemaVersion: SCHEMA_VERSION };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  // Envia para o Firestore se o sync estiver ativo
  if (window._fb?.scheduleSave) window._fb.scheduleSave(appData);
}

/**
 * Aplica migrações e garantias de integridade em um objeto de dados.
 * Usado tanto em load() quanto em importData().
 */
function applyMigrations(data) {
  if (!data.days)    data.days    = {};
  if (!data.backlog) data.backlog = [];
  if (!data.metas)   data.metas   = [];

  // Migra metas legadas (sem campo tipo) → manual
  data.metas = data.metas.map(m =>
    m.tipo ? m : { tipo: 'manual', autoFonte: null, tarefaTexto: null, ...m }
  );

  // Migra itens legados do backlog (string → objeto) + adiciona campo arquivado
  data.backlog = data.backlog.map((item, idx) => {
    const base = typeof item === 'string'
      ? { id: Date.now() + idx, text: item, porte: 'pequena', tipo: 'unica' }
      : item;
    return 'arquivado' in base ? base : { ...base, arquivado: false };
  });

  // Garante estrutura correta em dias antigos
  for (const key in data.days) {
    const d = data.days[key];
    if (!Array.isArray(d.medium))   d.medium   = defaultDay().medium;
    if (!Array.isArray(d.small))    d.small    = defaultDay().small;
    if (!d.balance)                 d.balance  = { work: 8, personal: 8, sleep: 8 };
    if (!Array.isArray(d.captures)) d.captures = [];
  }

  return data;
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('invalid');
      appData = applyMigrations({
        days:    parsed.days    || {},
        backlog: parsed.backlog || [],
        metas:   parsed.metas   || []
      });
    } catch(e) {
      appData = { days: {}, backlog: [], metas: [] };
    }
  }
}

// ══════════════════════════════════════════════
// PROGRESSO E STATUS
// ══════════════════════════════════════════════

function calcProgress(day) {
  let total = 0, done = 0;
  if (day.bigGoal)  { total++; if (day.bigDone)  done++; }
  day.medium.forEach(t => { if (t.text) { total++; if (t.done) done++; } });
  day.small.forEach(t  => { if (t.text) { total++; if (t.done) done++; } });
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

function autoStatus(day) {
  const p = calcProgress(day);
  if (p.total === 0) return null;
  if (day.bigDone && p.pct >= 80) return 'acao';
  if (day.bigDone || p.pct >= 55) return 'normal';
  if (p.pct >= 25 || p.done > 0)  return 'cansativo';
  return 'neutro';
}

// ══════════════════════════════════════════════
// RENDER PRINCIPAL
// ══════════════════════════════════════════════

function render() {
  renderHeader();
  renderProgress();
  if (currentView === 'today') renderDayView();
  else if (currentView === 'plan') renderPlanView();
  else if (currentView === 'backlog') renderBacklog();
  else if (currentView === 'retro') renderRetroView();
  else if (currentView === 'metas') renderMetasView();
}

// ── Header ──
function renderHeader() {
  const today = todayString();
  const d = currentDate;

  // Sub-label: dia da semana abreviado
  const parsed = parseLocal(d);
  document.getElementById('hSub').textContent =
    isToday(d) ? 'hoje' : DIAS_CURTO[parsed.getDay()];

  // Main: "12 ABR" ou "12 de Abril"
  document.getElementById('hMain').textContent =
    `${pad(parsed.getDate())} ${MESES_CURTO[parsed.getMonth()]} ${parsed.getFullYear()}`;

  // Botão voltar
  const backBtn = document.getElementById('headerBack');
  backBtn.style.display = isToday(d) ? 'none' : '';

  // Status pill
  const day = getDay(d);
  const status = day.status || autoStatus(day);
  const pill = document.getElementById('statusPill');
  pill.textContent = status ? STATUS_LABELS[status] : '—';
  pill.className   = `status-pill ${status || ''}`;
}

// ── Progress bar ──
function renderProgress() {
  const day = getDay(currentDate);
  const p = calcProgress(day);
  document.getElementById('progText').textContent =
    p.total > 0 ? `${p.done} / ${p.total} tarefas` : '— tarefas';
  document.getElementById('progPct').textContent =
    p.total > 0 ? `${p.pct}%` : '—';
  document.getElementById('progFill').style.width = `${p.pct}%`;
}

// ══════════════════════════════════════════════
// DAY VIEW (Hoje)
// ══════════════════════════════════════════════

function renderDayView() {
  const day = getDay(currentDate);
  renderBigGoal(day);
  renderTasks(day);
  renderBalance(day);
  renderCaptures(day);
  renderFechaDia();
}

// ── Big Goal ──
function renderBigGoal(day) {
  const display = document.getElementById('bigDisplay');
  const input   = document.getElementById('bigInput');
  const check   = document.getElementById('bigCheck');

  if (day.bigGoal) {
    display.textContent = day.bigGoal;
    display.classList.remove('is-placeholder');
    display.classList.toggle('is-done', day.bigDone);
  } else {
    display.textContent = 'Qual é o seu grande objetivo hoje?';
    display.classList.add('is-placeholder');
    display.classList.remove('is-done');
  }

  input.value = day.bigGoal;
  check.classList.toggle('is-done', day.bigDone);
}

function editBig() {
  const display = document.getElementById('bigDisplay');
  const input   = document.getElementById('bigInput');
  // Guard: já está em modo de edição
  if (!input.classList.contains('hidden')) return;
  const day = getDay(currentDate);
  display.classList.add('hidden');
  input.classList.remove('hidden');
  input.value = day.bigGoal;
  // setTimeout(0) aguarda o browser terminar o reflow após display:none→block
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function saveBig() {
  const day   = getDay(currentDate);
  const input = document.getElementById('bigInput');
  const val   = input.value.trim();
  day.bigGoal = val;
  if (!val) day.bigDone = false;
  save();
  input.classList.add('hidden');
  document.getElementById('bigDisplay').classList.remove('hidden');
  renderBigGoal(day);
  renderProgress();
  renderHeader();
}

function toggleBig() {
  const day = getDay(currentDate);
  if (!day.bigGoal) return;
  day.bigDone = !day.bigDone;
  save();
  renderBigGoal(day);
  renderProgress();
  renderHeader();
}

// ── Tasks ──
function renderTasks(day) {
  renderTaskGroup('med', day.medium, 3, 'medList', 'medCount');
  renderTaskGroup('small', day.small, 5, 'smallList', 'smallCount');
}

function renderTaskGroup(type, tasks, max, listId, countId) {
  const list  = document.getElementById(listId);
  const count = document.getElementById(countId);
  list.innerHTML = '';

  let done = 0;
  tasks.forEach((task, i) => {
    if (task.done) done++;
    const item = document.createElement('div');
    item.className = 'task-item';

    // Checkbox
    const check = document.createElement('button');
    check.className = `sq-check ${task.done ? 'is-done' : ''}`;
    check.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/></svg>`;
    check.onclick = (e) => { e.stopPropagation(); toggleTask(type, i); };

    // Input direto — sem span, sem troca, clique único já edita
    const input = document.createElement('input');
    input.type        = 'text';
    input.className   = `task-inline ${task.done ? 'is-done' : ''} ${!task.text ? 'is-empty' : ''}`;
    input.placeholder = type === 'med' ? `Objetivo médio ${i+1}` : `Objetivo pequeno ${i+1}`;
    input.value       = task.text;

    input.onblur = () => {
      const day   = getDay(currentDate);
      const tasks = type === 'med' ? day.medium : day.small;
      const val   = input.value.trim();
      tasks[i].text = val;
      if (!val) tasks[i].done = false;
      save();
      // Atualiza apenas estado visual sem re-renderizar tudo
      input.classList.toggle('is-empty', !val);
      input.classList.toggle('is-done', !!val && tasks[i].done);
      renderProgress();
      renderHeader();
      // Atualiza o checkbox visual se necessário
      check.classList.toggle('is-done', tasks[i].done);
      const countEl = document.getElementById(countId);
      let d = 0;
      tasks.forEach(t => { if (t.done) d++; });
      countEl.textContent = `${d}/${max}`;
      countEl.classList.toggle('has-progress', d > 0);
    };

    input.onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
        // Foca próximo input se existir
        const inputs = list.querySelectorAll('.task-inline');
        if (inputs[i + 1]) inputs[i + 1].focus();
      }
      if (e.key === 'Escape') input.blur();
    };

    item.appendChild(check);
    item.appendChild(input);
    list.appendChild(item);
  });

  const hasDone = done > 0;
  count.textContent = `${done}/${max}`;
  count.classList.toggle('has-progress', hasDone);
}

function saveTask() { /* mantido por compatibilidade — lógica movida para onblur inline */ }
function editTask()  { /* mantido por compatibilidade — não mais necessário */ }

function toggleTask(type, index) {
  const day    = getDay(currentDate);
  const tasks  = type === 'med' ? day.medium : day.small;
  if (!tasks[index].text) return;
  tasks[index].done = !tasks[index].done;
  save();
  // Re-render a lista do grupo afetado para refletir o estado novo
  const max    = type === 'med' ? 3 : 5;
  const listId = type === 'med' ? 'medList' : 'smallList';
  const countId = type === 'med' ? 'medCount' : 'smallCount';
  renderTaskGroup(type, tasks, max, listId, countId);
  renderProgress();
  renderHeader();
}

// ── Balance ──
function renderBalance(day) {
  const b = day.balance;
  const total = b.work + b.personal + b.sleep;

  document.getElementById('workH').textContent     = b.work;
  document.getElementById('personalH').textContent = b.personal;
  document.getElementById('sleepH').textContent    = b.sleep;

  document.getElementById('workFill').style.width     = `${(b.work / 24) * 100}%`;
  document.getElementById('personalFill').style.width = `${(b.personal / 24) * 100}%`;
  document.getElementById('sleepFill').style.width    = `${(b.sleep / 24) * 100}%`;

  const totalEl = document.getElementById('balTotal');
  if (total === 24) {
    totalEl.textContent = '24h ✓';
    totalEl.className   = 'bal-total is-ok';
  } else if (total > 24) {
    totalEl.textContent = `${total}h (${total - 24}h a mais)`;
    totalEl.className   = 'bal-total is-over';
  } else {
    totalEl.textContent = `${total}h (faltam ${24 - total}h)`;
    totalEl.className   = 'bal-total';
  }
}

function adjustBal(type, delta) {
  const day = getDay(currentDate);
  const val = day.balance[type] + delta;
  if (val < 0 || val > 24) return;
  day.balance[type] = val;
  save();
  renderBalance(day);
}

// ── Captures ──
function renderCaptures(day) {
  const list = document.getElementById('captureList');
  list.innerHTML = '';
  if (day.captures.length === 0) {
    list.innerHTML = '<p class="empty-hint">Nenhuma captura ainda — registre suas ideias aqui</p>';
    return;
  }
  day.captures.forEach((text, i) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <span class="list-item-text">${escHtml(text)}</span>
      <button class="list-item-del" onclick="removeCapture(${i})">×</button>`;
    list.appendChild(item);
  });
}

function addCapture() {
  const input = document.getElementById('captureInput');
  const val   = input.value.trim();
  if (!val) return;
  const day = getDay(currentDate);
  day.captures.unshift(val);
  save();
  input.value = '';
  renderCaptures(day);
}

function removeCapture(index) {
  const day = getDay(currentDate);
  day.captures.splice(index, 1);
  save();
  renderCaptures(day);
}

// ══════════════════════════════════════════════
// PLAN VIEW — Calendário mensal completo
// ══════════════════════════════════════════════

const STATUS_COLORS = {
  normal:      'var(--green)',
  acao:        'var(--blue)',
  compromisso: 'var(--red)',
  cansativo:   'var(--orange)',
  relaxar:     'var(--purple)',
  neutro:      'var(--gold)'
};

// Valores hex reais para uso em JS onde CSS variables não funcionam
// (ex: box-shadow com alpha, gradientes inline)
const STATUS_HEX = {
  normal:      '#34d399',
  acao:        '#60a5fa',
  compromisso: '#f87171',
  cansativo:   '#fb923c',
  relaxar:     '#a78bfa',
  neutro:      '#fbbf24'
};

// Metadados do backlog inteligente
const PORTE_LABELS = { grande: 'Grande', media: 'Média', pequena: 'Pequena' };
const PORTE_COLORS = { grande: 'var(--gold)', media: 'var(--blue)', pequena: 'var(--green)' };
const TIPO_LABELS  = { unica: 'Única', recorrente: '↻ Recorrente' };

function renderPlanView() {
  const today  = todayString();
  const grid   = document.getElementById('calGrid');
  const label  = document.getElementById('calMonthLabel');

  // Atualiza o rótulo do mês
  label.textContent = `${MESES_FULL[calMonth].toUpperCase()} ${calYear}`;

  // Mostra/oculta botão "ir para hoje" conforme mês exibido
  const nowD = new Date();
  const onToday = calYear === nowD.getFullYear() && calMonth === nowD.getMonth();
  document.querySelector('.cal-today-btn').style.visibility = onToday ? 'hidden' : 'visible';

  grid.innerHTML = '';

  const firstDay    = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const startDow    = firstDay.getDay(); // 0=DOM … 6=SÁB

  // ── Células de preenchimento iniciais ──
  for (let i = 0; i < startDow; i++) {
    grid.appendChild(makeFillerCell());
  }

  // ── Células dos dias do mês ──
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calYear}-${pad(calMonth + 1)}-${pad(d)}`;
    const dayData = appData.days[dateStr];

    const hasData = !!dayData && (
      dayData.bigGoal                      ||
      dayData.medium.some(t => t.text)     ||
      dayData.small.some(t => t.text)      ||
      (dayData.captures && dayData.captures.length > 0)
    );

    const p = hasData ? calcProgress(dayData) : null;

    // Status manual (definido pelo usuário) aparece sempre, mesmo sem tarefas.
    // Auto-status só é calculado quando há dados reais no dia.
    const status = (dayData && dayData.status)
                 ? dayData.status
                 : (hasData ? autoStatus(dayData) : null);

    const isT   = dateStr === today;
    const isSel = dateStr === currentDate;
    const isPast = dateStr < today;

    // Classes do estado visual
    let cls = 'cal-cell';
    if (isT)              cls += ' is-today';
    else if (isSel)       cls += ' is-selected';
    if (isPast && !isT)   cls += ' is-past';
    if (hasData)          cls += ' has-data';

    const cell  = document.createElement('button');
    cell.className = cls;

    // Status sempre prevalece — sobrescreve borda e glow de today/selected
    if (status) {
      const clrVar = STATUS_COLORS[status];   // 'var(--red)' etc  — para border
      const clrHex = STATUS_HEX[status];      // '#f87171' etc — para box-shadow com alpha

      cell.style.borderColor = clrVar;

      if (isT) {
        // Hoje: mantém fundo verde, apenas troca borda e adiciona glow do status
        cell.style.boxShadow = `0 0 0 1px ${clrHex}44, inset 0 1px 0 ${clrHex}33`;
      } else {
        // Selecionado ou normal com status: glow na cor do status
        cell.style.boxShadow = `0 0 0 1px ${clrHex}33, inset 0 1px 0 ${clrHex}22`;
      }
    }

    // Cor do ponto de status
    const dotClr = status
      ? STATUS_HEX[status]
      : (hasData ? '#56575c' : 'transparent');

    // Largura e cor da barra de progresso
    const barPct = p && p.total > 0 ? p.pct : 0;
    const barClr = status ? STATUS_HEX[status] : '#34d399';

    // Cor do número — sempre usa a cor do status se existir
    const numClr = status ? `color:${STATUS_HEX[status]}` : '';

    cell.innerHTML = `
      <span class="cal-num" style="${numClr}">${d}</span>
      <span class="cal-dot" style="background:${dotClr}"></span>
      <div class="cal-bar">
        <div class="cal-bar-fill" style="width:${barPct}%;background:${barClr}"></div>
      </div>`;

    cell.onclick = () => openDay(dateStr);
    grid.appendChild(cell);
  }

  // ── Células de preenchimento finais (completa a última semana) ──
  const trailing = (7 - ((startDow + daysInMonth) % 7)) % 7;
  for (let i = 0; i < trailing; i++) {
    grid.appendChild(makeFillerCell());
  }
}

function makeFillerCell() {
  const div = document.createElement('div');
  div.className = 'cal-cell is-filler';
  return div;
}

// ── Navegação entre meses ──
function prevMonth() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderPlanView();
}

function nextMonth() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderPlanView();
}

/** Volta o calendário para o mês de hoje (não altera o dia selecionado) */
function calJumpToday() {
  const now = new Date();
  calYear   = now.getFullYear();
  calMonth  = now.getMonth();
  renderPlanView();
}

function openDay(dateStr) {
  currentDate = dateStr;
  switchView('today');
}

// ══════════════════════════════════════════════
// BACKLOG VIEW
// ══════════════════════════════════════════════

function renderBacklog() {
  const list    = document.getElementById('backlogList');
  const countEl = document.getElementById('backlogCount');
  list.innerHTML = '';

  // Separa ativos e arquivados
  const allActive    = appData.backlog.filter(t => !(typeof t === 'object' && t.arquivado));
  const archivedItems = appData.backlog.filter(t => typeof t === 'object' && t.arquivado);

  // Aplica filtro de tipo
  const filtroLabels = { unicas: 'únicas', recorrentes: 'recorrentes' };
  const activeItems  = _backlogFiltro === 'todas' ? allActive
    : allActive.filter(t => {
        const tipo = typeof t === 'object' ? t.tipo : 'unica';
        return _backlogFiltro === 'unicas' ? tipo !== 'recorrente' : tipo === 'recorrente';
      });

  if (countEl) countEl.textContent = allActive.length;

  if (allActive.length === 0 && archivedItems.length === 0) {
    list.innerHTML = '<p class="empty-hint">Backlog vazio — adicione tarefas e ideias para usar quando chegar a hora.</p>';
    return;
  }

  if (activeItems.length === 0) {
    const msg = _backlogFiltro !== 'todas'
      ? `Nenhuma tarefa ${filtroLabels[_backlogFiltro]} no backlog ativo.`
      : 'Backlog ativo limpo.';
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = msg;
    list.appendChild(empty);
  }

  // ── Itens ativos (filtrados) ──
  // Usamos índice original do backlog para archiveBacklog/removeBacklog funcionar
  appData.backlog.forEach((raw, i) => {
    const task = typeof raw === 'string'
      ? { text: raw, porte: 'pequena', tipo: 'unica', arquivado: false }
      : raw;
    if (task.arquivado) return;
    // Aplica filtro
    if (_backlogFiltro === 'unicas'      && task.tipo === 'recorrente') return;
    if (_backlogFiltro === 'recorrentes' && task.tipo !== 'recorrente') return;

    const porteClr   = PORTE_COLORS[task.porte] || 'var(--text3)';
    const porteLabel = PORTE_LABELS[task.porte]  || task.porte;
    const tipoLabel  = TIPO_LABELS[task.tipo]     || task.tipo;
    const isRecorr   = task.tipo === 'recorrente';

    const item = document.createElement('div');
    item.className = 'bl-item';
    item.innerHTML = `
      <div class="bl-item-main">
        <span class="bl-item-text">${escHtml(task.text)}</span>
        <div class="bl-item-badges">
          <span class="bl-badge bl-porte" style="color:${porteClr};border-color:${porteClr}">${porteLabel}</span>
          <span class="bl-badge ${isRecorr ? 'bl-recorrente' : 'bl-unica'}">${tipoLabel}</span>
        </div>
      </div>
      <div class="bl-item-actions">
        <button class="list-item-archive" title="Arquivar" onclick="archiveBacklog(${i})">↓</button>
        <button class="list-item-send"    title="Enviar para um dia" onclick="openDayPicker(${i})">↗</button>
        <button class="list-item-del"     onclick="removeBacklog(${i})">×</button>
      </div>`;
    list.appendChild(item);
  });

  // ── Seção arquivados (colapsável) ──
  if (archivedItems.length > 0) {
    const archSection = document.createElement('div');
    archSection.className = 'bl-archived-section';

    const toggle = document.createElement('button');
    toggle.className = 'bl-archived-toggle';
    toggle.innerHTML = `<span>Arquivadas</span><span class="bl-archived-count">${archivedItems.length}</span>`;
    toggle.onclick = () => {
      const items = archSection.querySelector('.bl-archived-items');
      const open  = items.style.display !== 'none';
      items.style.display = open ? 'none' : '';
      toggle.classList.toggle('is-open', !open);
    };
    archSection.appendChild(toggle);

    const archivedEl = document.createElement('div');
    archivedEl.className = 'bl-archived-items';
    archivedEl.style.display = 'none'; // fechado por padrão

    appData.backlog.forEach((raw, i) => {
      const task = typeof raw === 'object' ? raw : null;
      if (!task || !task.arquivado) return;

      const porteClr   = PORTE_COLORS[task.porte] || 'var(--text3)';
      const porteLabel = PORTE_LABELS[task.porte]  || task.porte;
      const tipoLabel  = TIPO_LABELS[task.tipo]     || task.tipo;
      const isRecorr   = task.tipo === 'recorrente';

      const item = document.createElement('div');
      item.className = 'bl-item is-archived';
      item.innerHTML = `
        <div class="bl-item-main">
          <span class="bl-item-text">${escHtml(task.text)}</span>
          <div class="bl-item-badges">
            <span class="bl-badge bl-porte" style="color:${porteClr};border-color:${porteClr}">${porteLabel}</span>
            <span class="bl-badge ${isRecorr ? 'bl-recorrente' : 'bl-unica'}">${tipoLabel}</span>
          </div>
        </div>
        <div class="bl-item-actions">
          <button class="list-item-restore" title="Restaurar" onclick="restoreBacklog(${i})">↑</button>
          <button class="list-item-del"     onclick="removeBacklog(${i})">×</button>
        </div>`;
      archivedEl.appendChild(item);
    });

    archSection.appendChild(archivedEl);
    list.appendChild(archSection);
  }
}

/** Arquiva item do backlog (mantém no array, mas oculta do ativo) */
function archiveBacklog(index) {
  if (!appData.backlog[index]) return;
  appData.backlog[index].arquivado = true;
  save();
  renderBacklog();
  showToast('↓ Tarefa arquivada');
}

/** Restaura item arquivado de volta ao backlog ativo */
function restoreBacklog(index) {
  if (!appData.backlog[index]) return;
  appData.backlog[index].arquivado = false;
  save();
  renderBacklog();
  showToast('↑ Tarefa restaurada', 'green');
}

/** Seleciona chip e desativa os demais do mesmo grupo */
function selectChip(btn) {
  const group = btn.dataset.group;
  document.querySelectorAll(`.bl-chip[data-group="${group}"]`)
    .forEach(c => c.classList.remove('is-active'));
  btn.classList.add('is-active');
}

/** Retorna o valor do chip ativo de um grupo */
function getChipVal(group, fallback) {
  const el = document.querySelector(`.bl-chip[data-group="${group}"].is-active`);
  return el ? el.dataset.val : fallback;
}

function addBacklog() {
  const input = document.getElementById('backlogInput');
  const val   = input.value.trim();
  if (!val) return;

  const task = {
    id:    Date.now(),
    text:  val,
    porte: getChipVal('porte', 'pequena'),
    tipo:  getChipVal('tipo',  'unica'),
  };

  appData.backlog.unshift({ ...task, arquivado: false });
  save();
  input.value = '';
  input.focus(); // mantém foco para entradas rápidas
  renderBacklog();
  showToast('✓ Adicionado ao backlog', 'green');
}

function removeBacklog(index) {
  appData.backlog.splice(index, 1);
  save();
  renderBacklog();
  showToast('× Tarefa removida');
}

// ══════════════════════════════════════════════
// ENVIAR BACKLOG PARA DIA (modal)
// ══════════════════════════════════════════════

let _pendingBacklogIndex = null;

function openDayPicker(index) {
  _pendingBacklogIndex = index;
  const raw  = appData.backlog[index] || '';
  const task = typeof raw === 'string' ? { text: raw, porte: 'pequena', tipo: 'unica' } : raw;
  document.getElementById('modalTaskLabel').textContent = `"${task.text}"`;

  const grid = document.getElementById('dayPickerGrid');
  grid.innerHTML = '';
  const today = todayString();

  // Hoje + próximos 13 dias = 14 opções
  for (let i = 0; i < 14; i++) {
    const dateStr = addDays(today, i);
    const parsed  = parseLocal(dateStr);
    const isT     = dateStr === today;

    const btn = document.createElement('button');
    btn.className = `dp-day${isT ? ' is-today' : ''}`;
    btn.innerHTML = `
      <span class="dp-name">${DIAS_CURTO[parsed.getDay()]}</span>
      <span class="dp-num">${pad(parsed.getDate())}</span>
      <span class="dp-month">${MESES_CURTO[parsed.getMonth()]}</span>`;
    btn.onclick = () => sendBacklogToDay(dateStr);
    grid.appendChild(btn);
  }

  document.getElementById('dayPickerOverlay').classList.remove('hidden');
  document.getElementById('dayPickerModal').classList.remove('hidden');
}

function closeDayPicker() {
  _pendingBacklogIndex = null;
  document.getElementById('dayPickerOverlay').classList.add('hidden');
  document.getElementById('dayPickerModal').classList.add('hidden');
}

function sendBacklogToDay(dateStr) {
  if (_pendingBacklogIndex === null) return;
  const raw = appData.backlog[_pendingBacklogIndex];
  if (raw == null) { closeDayPicker(); return; }

  // Normaliza item legado
  const task = typeof raw === 'string'
    ? { text: raw, porte: 'pequena', tipo: 'unica' }
    : raw;

  const day = getDay(dateStr);

  // ── Roteamento inteligente por porte ──
  if (task.porte === 'grande') {
    if (!day.bigGoal) {
      // Slot livre → vai para o grande objetivo
      day.bigGoal = task.text;
      day.bigDone = false;
    } else {
      // Grande objetivo já preenchido → tenta primeiro médio livre
      const slot = day.medium.findIndex(t => !t.text);
      if (slot !== -1) day.medium[slot].text = task.text;
      else             day.captures.unshift(task.text); // fallback: captura
    }

  } else if (task.porte === 'media') {
    const slot = day.medium.findIndex(t => !t.text);
    if (slot !== -1) {
      day.medium[slot].text = task.text;
    } else {
      // Médios cheios → tenta pequeno
      const sSlot = day.small.findIndex(t => !t.text);
      if (sSlot !== -1) day.small[sSlot].text = task.text;
      else              day.captures.unshift(task.text); // fallback: captura
    }

  } else {
    // pequena (default)
    const slot = day.small.findIndex(t => !t.text);
    if (slot !== -1) {
      day.small[slot].text = task.text;
    } else {
      day.captures.unshift(task.text); // fallback: captura
    }
  }

  // ── Lógica única vs recorrente ──
  // Única: some do backlog após ser usada
  // Recorrente: permanece no backlog
  if (task.tipo !== 'recorrente') {
    appData.backlog.splice(_pendingBacklogIndex, 1);
  }

  save();
  closeDayPicker();
  renderBacklog();
  const isToday = dateStr === todayString();
  const label   = isToday ? 'hoje' : formatShort(dateStr);
  showToast(`↗ Enviado para ${label}`, 'blue');
}

// ══════════════════════════════════════════════
// MONTAR DIA AUTOMÁTICO (Bloco 4B)
// ══════════════════════════════════════════════

/** Embaralha array in-place (Fisher-Yates) */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Monta o dia atual automaticamente usando o backlog:
 * — Preenche apenas slots vazios (nunca sobrescreve)
 * — Respeita porte: grande→bigGoal, media→medium[], pequena→small[]
 * — Evita duplicatas (textos já presentes no dia são ignorados)
 * — Únicos saem do backlog; recorrentes permanecem
 */
function montarDia() {
  const day = getDay(currentDate);

  // 1. Coleta textos já presentes no dia para evitar duplicatas
  const usedTexts = new Set();
  if (day.bigGoal) usedTexts.add(day.bigGoal.trim().toLowerCase());
  day.medium.forEach(t => { if (t.text) usedTexts.add(t.text.trim().toLowerCase()); });
  day.small.forEach(t  => { if (t.text) usedTexts.add(t.text.trim().toLowerCase()); });

  // 2. Separa backlog por porte, mantendo índice original, excluindo duplicatas
  const pool = appData.backlog.map((raw, i) => {
    const task = typeof raw === 'string'
      ? { text: raw, porte: 'pequena', tipo: 'unica' }
      : raw;
    return { task, i };
  }).filter(({ task }) => !usedTexts.has(task.text.trim().toLowerCase()) && !task.arquivado);

  const grandes  = shuffle(pool.filter(({ task }) => task.porte === 'grande'));
  const medias   = shuffle(pool.filter(({ task }) => task.porte === 'media'));
  const pequenas = shuffle(pool.filter(({ task }) => task.porte === 'pequena'));

  // Registra quais índices do backlog foram usados (para remoção posterior)
  const usedIndexes = []; // { i, tipo }

  // 3. Preenche grande objetivo (só se estiver vazio)
  if (!day.bigGoal && grandes.length > 0) {
    const { task, i } = grandes.shift();
    day.bigGoal = task.text;
    day.bigDone = false;
    usedIndexes.push({ i, tipo: task.tipo });
    usedTexts.add(task.text.trim().toLowerCase());
  }

  // 4. Preenche médios — apenas slots vazios
  let gi = 0;
  for (const slot of day.medium) {
    if (slot.text || gi >= medias.length) continue;
    const { task, i } = medias[gi++];
    slot.text = task.text;
    slot.done = false;
    usedIndexes.push({ i, tipo: task.tipo });
    usedTexts.add(task.text.trim().toLowerCase());
  }

  // 5. Preenche pequenos — apenas slots vazios
  let pi = 0;
  for (const slot of day.small) {
    if (slot.text || pi >= pequenas.length) continue;
    const { task, i } = pequenas[pi++];
    slot.text = task.text;
    slot.done = false;
    usedIndexes.push({ i, tipo: task.tipo });
    usedTexts.add(task.text.trim().toLowerCase());
  }

  // 6. Remove únicos do backlog (ordem reversa para preservar índices)
  usedIndexes
    .filter(u => u.tipo !== 'recorrente')
    .map(u => u.i)
    .sort((a, b) => b - a)
    .forEach(i => appData.backlog.splice(i, 1));

  save();
  render();

  // Feedback visual: pisca o botão brevemente
  const btn = document.getElementById('montarBtn');
  if (btn) {
    btn.classList.add('is-done');
    setTimeout(() => btn.classList.remove('is-done'), 1200);
  }
}

// ══════════════════════════════════════════════
// RETROSPECTIVA
// ══════════════════════════════════════════════

function renderRetroView() {
  const today = todayString();

  // Pega todos os dias passados com dados e aplica filtro de período
  const cutoff = _retroFiltro === 'todos' ? null : addDays(today, -parseInt(_retroFiltro));
  const pastDays = Object.keys(appData.days)
    .filter(k => k < today && (cutoff === null || k >= cutoff))
    .sort((a, b) => b.localeCompare(a)); // mais recente primeiro

  // ── Streak ──
  let streak = 0;
  let check = addDays(today, -1);
  while (true) {
    const d = appData.days[check];
    if (!d) break;
    const p = calcProgress(d);
    if (p.total === 0) break;
    if (p.pct < 25 && !d.bigDone) break;
    streak++;
    check = addDays(check, -1);
  }
  const streakEl = document.getElementById('retroStreak');
  if (streak > 0) {
    streakEl.textContent = `🔥 ${streak} dia${streak > 1 ? 's' : ''}`;
    streakEl.style.display = '';
  } else {
    streakEl.style.display = 'none';
  }

  // ── Stats gerais ──
  const statsEl = document.getElementById('retroStats');
  if (pastDays.length === 0) {
    statsEl.innerHTML = '';
  } else {
    const totalDays = pastDays.length;
    const dominated = pastDays.filter(k => {
      const d = appData.days[k];
      const s = d.status || autoStatus(d);
      return s === 'acao' || s === 'normal';
    }).length;
    const avgPct = Math.round(
      pastDays.reduce((sum, k) => {
        const p = calcProgress(appData.days[k]);
        return sum + p.pct;
      }, 0) / totalDays
    );

    statsEl.innerHTML = `
      <div class="retro-stat-row">
        <div class="retro-stat">
          <span class="retro-stat-val">${totalDays}</span>
          <span class="retro-stat-label">Dias registrados</span>
        </div>
        <div class="retro-stat">
          <span class="retro-stat-val">${dominated}</span>
          <span class="retro-stat-label">Dias produtivos</span>
        </div>
        <div class="retro-stat">
          <span class="retro-stat-val">${avgPct}%</span>
          <span class="retro-stat-label">Média de conclusão</span>
        </div>
      </div>`;
  }

  // ── Lista de dias ──
  const list = document.getElementById('retroList');
  list.innerHTML = '';

  if (pastDays.length === 0) {
    const emptyMsg = _retroFiltro !== 'todos'
      ? `Nenhum dia registrado nos últimos ${_retroFiltro} dias. Use o filtro "Todos" para ver o histórico completo.`
      : 'Nenhum dia registrado ainda. Complete o planner de hoje para iniciar seu histórico.';
    list.innerHTML = `<p class="empty-hint">${emptyMsg}</p>`;
    return;
  }

  pastDays.forEach(dateStr => {
    const day    = appData.days[dateStr];
    const p      = calcProgress(day);
    const status = day.status || autoStatus(day);
    const parsed = parseLocal(dateStr);

    const item = document.createElement('div');
    item.className = 'retro-item';
    item.onclick   = () => openDay(dateStr);

    const statusColor = STATUS_COLORS[status] || 'var(--text3)';

    const statusLabel = STATUS_LABELS[status] || '—';

    item.innerHTML = `
      <div class="retro-item-left">
        <div class="retro-item-date">
          <span class="retro-item-weekday">${DIAS_CURTO[parsed.getDay()]}</span>
          <span class="retro-item-day">${pad(parsed.getDate())}</span>
          <span class="retro-item-month">${MESES_CURTO[parsed.getMonth()]}</span>
        </div>
        <div class="retro-item-info">
          <div class="retro-item-goal">${escHtml(day.bigGoal || '—')}</div>
          <div class="retro-item-tasks">${p.done}/${p.total} tarefas concluídas</div>
        </div>
      </div>
      <div class="retro-item-right">
        <div class="retro-pill" style="color:${statusColor};border-color:${statusColor}">${statusLabel}</div>
        <div class="retro-pct" style="color:${statusColor}">${p.total > 0 ? p.pct + '%' : '—'}</div>
        <div class="retro-bar-wrap">
          <div class="retro-bar-fill" style="width:${p.pct}%;background:${statusColor}"></div>
        </div>
      </div>`;
    list.appendChild(item);
  });
}

// ══════════════════════════════════════════════
// FECHAR DIA / PENDÊNCIAS (Bloco 6A)
// ══════════════════════════════════════════════

/** Estado: lista de tarefas pendentes atual (para o modal) */
let _pendingTasks = [];

/**
 * Retorna as tarefas pendentes (com texto mas sem done=true) do dia informado.
 * Cada item: { texto, porte, slot: 'big'|'med'|'small', index: número ou null }
 */
function getPendencias(dateStr) {
  const day = getDay(dateStr);
  const list = [];
  if (day.bigGoal && !day.bigDone) {
    list.push({ texto: day.bigGoal, porte: 'grande', slot: 'big', index: null });
  }
  day.medium.forEach((t, i) => {
    if (t.text && !t.done) list.push({ texto: t.text, porte: 'media',   slot: 'med',   index: i });
  });
  day.small.forEach((t, i) => {
    if (t.text && !t.done) list.push({ texto: t.text, porte: 'pequena', slot: 'small', index: i });
  });
  return list;
}

/** Mostra/esconde o botão "Fechar Dia" com contagem de pendências */
function renderFechaDia() {
  const section = document.getElementById('fechaDiaSection');
  if (!section) return;
  const pending = getPendencias(currentDate);
  const badge   = document.getElementById('fechaDiaBadge');
  if (pending.length === 0) {
    section.classList.add('hidden');
  } else {
    section.classList.remove('hidden');
    if (badge) badge.textContent = pending.length;
  }
}

/** Abre o modal de pendências do dia atual */
function fecharDia() {
  _pendingTasks = getPendencias(currentDate);
  if (!_pendingTasks.length) return;
  _renderPendenciasModal();
  document.getElementById('fechaDiaOverlay').classList.remove('hidden');
  document.getElementById('fechaDiaModal').classList.remove('hidden');
}

/** Fecha o modal de pendências */
function closePendencias() {
  document.getElementById('fechaDiaOverlay').classList.add('hidden');
  document.getElementById('fechaDiaModal').classList.add('hidden');
  _pendingTasks = [];
}

/** Renderiza (ou atualiza) o conteúdo do modal de pendências */
function _renderPendenciasModal() {
  _pendingTasks = getPendencias(currentDate); // sempre atualizado
  const list     = document.getElementById('pendenciasList');
  const subtitle = document.getElementById('fechaDiaSubtitle');
  if (!list) return;

  if (!_pendingTasks.length) {
    closePendencias();
    renderDayView();
    return;
  }

  const n = _pendingTasks.length;
  subtitle.textContent = `${n} tarefa${n > 1 ? 's' : ''} não concluída${n > 1 ? 's' : ''}`;

  list.innerHTML = _pendingTasks.map((p, idx) => {
    const porteClr   = PORTE_COLORS[p.porte] || 'var(--text3)';
    const porteLabel = PORTE_LABELS[p.porte]  || p.porte;
    return `
      <div class="pendencias-item">
        <div class="pendencias-item-info">
          <span class="bl-badge bl-porte" style="color:${porteClr};border-color:${porteClr}">${porteLabel}</span>
          <span class="pendencias-item-text">${escHtml(p.texto)}</span>
        </div>
        <div class="pendencias-item-actions">
          <button class="pend-btn pend-backlog" onclick="moverParaBacklog(${idx})">↩ Backlog</button>
          <button class="pend-btn pend-amanha"  onclick="moverParaAmanha(${idx})">→ Amanhã</button>
        </div>
      </div>`;
  }).join('');
}

/** Remove a tarefa pendente do slot correto no dia atual */
function _clearTaskFromDay(p) {
  const day = getDay(currentDate);
  if (p.slot === 'big') {
    day.bigGoal = '';
    day.bigDone = false;
  } else if (p.slot === 'med') {
    day.medium[p.index] = { text: '', done: false };
  } else {
    day.small[p.index]  = { text: '', done: false };
  }
}

/**
 * Roteia o texto de uma tarefa para um dia usando a lógica de porte.
 * Mesma lógica de sendBacklogToDay — evita duplicar código.
 */
function _routeTaskToDay(day, texto, porte) {
  if (porte === 'grande') {
    if (!day.bigGoal) {
      day.bigGoal = texto; day.bigDone = false;
    } else {
      const s = day.medium.findIndex(t => !t.text);
      if (s !== -1) day.medium[s].text = texto;
      else          day.captures.unshift(texto);
    }
  } else if (porte === 'media') {
    const s = day.medium.findIndex(t => !t.text);
    if (s !== -1) {
      day.medium[s].text = texto;
    } else {
      const ss = day.small.findIndex(t => !t.text);
      if (ss !== -1) day.small[ss].text = texto;
      else           day.captures.unshift(texto);
    }
  } else {
    const s = day.small.findIndex(t => !t.text);
    if (s !== -1) day.small[s].text = texto;
    else          day.captures.unshift(texto);
  }
}

/** Move tarefa pendente [idx] de volta para o backlog ativo */
function moverParaBacklog(idx) {
  const p = _pendingTasks[idx];
  if (!p) return;

  _clearTaskFromDay(p);

  // Adiciona ao backlog (evita duplicata no ativo)
  const norm   = p.texto.trim().toLowerCase();
  const existe = appData.backlog.some(t =>
    typeof t === 'object' && !t.arquivado && t.text?.trim().toLowerCase() === norm
  );
  if (!existe) {
    appData.backlog.unshift({ id: Date.now(), text: p.texto, porte: p.porte, tipo: 'unica', arquivado: false });
  }

  save();
  _renderPendenciasModal();
  renderDayView();
  showToast('↩ Movida para o backlog');
}

/** Move tarefa pendente [idx] para o dia seguinte */
function moverParaAmanha(idx) {
  const p = _pendingTasks[idx];
  if (!p) return;

  _clearTaskFromDay(p);

  const amanha = addDays(currentDate, 1);
  _routeTaskToDay(getDay(amanha), p.texto, p.porte);

  save();
  _renderPendenciasModal();
  renderDayView();
  showToast(`→ Movida para ${formatShort(amanha)}`, 'blue');
}

// ══════════════════════════════════════════════
// NAVEGAÇÃO
// ══════════════════════════════════════════════

function switchView(view) {
  // NÃO reseta currentDate aqui — cada chamador é responsável por definir
  // qual data quer exibir antes de chamar switchView.
  // O botão "Hoje" da nav chama navToToday() que define currentDate = todayString().
  currentView = view;

  // Troca view ativa
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${view}`);
  if (target) target.classList.add('active');

  // Troca tab ativa
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  const tab = document.getElementById(`tab-${view}`);
  if (tab) tab.classList.add('active');

  // Rolar para o topo (exceto IA, que tem scroll próprio)
  if (view !== 'ia') document.getElementById('main').scrollTop = 0;

  render();

  // Inicializa view da IA na primeira abertura
  if (view === 'ia') initIAView();
}

function goToToday() {
  currentDate = todayString();
  render();
}

/** Chamada pelo botão "Hoje" da nav bar — reseta para hoje e abre a view */
function navToToday() {
  currentDate = todayString();
  switchView('today');
}

// ══════════════════════════════════════════════
// STATUS (clique na pill)
// ══════════════════════════════════════════════

function cycleStatus() {
  const day     = getDay(currentDate);
  const current = day.status;
  const idx     = STATUS_CYCLE.indexOf(current);
  day.status    = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
  save();
  renderHeader();
}

// ══════════════════════════════════════════════
// STATUS DROPDOWN — seleção rápida via chevron
// ══════════════════════════════════════════════

// Definição visual de cada opção do dropdown
const STATUS_DROPDOWN_OPTIONS = [
  { value: null,          label: 'Sem status',   hex: '#35363a' },
  { value: 'normal',      label: 'Dia Normal',   hex: '#34d399' },
  { value: 'acao',        label: 'Ação & Foco',  hex: '#60a5fa' },
  { value: 'compromisso', label: 'Compromisso',  hex: '#f87171' },
  { value: 'cansativo',   label: 'Cansativo',    hex: '#fb923c' },
  { value: 'relaxar',     label: 'Relaxar',      hex: '#a78bfa' },
  { value: 'neutro',      label: 'Neutro',       hex: '#fbbf24' },
];

let _dropdownOpen = false;

function toggleStatusDropdown(e) {
  e.stopPropagation();
  _dropdownOpen ? closeStatusDropdown() : openStatusDropdown();
}

function openStatusDropdown() {
  const wrap     = document.getElementById('statusWrap');
  const dropdown = document.getElementById('statusDropdown');
  const day      = getDay(currentDate);
  const current  = day.status || null;

  // Popula a lista toda vez que abre (garante estado atual)
  dropdown.innerHTML = '';

  STATUS_DROPDOWN_OPTIONS.forEach((opt, i) => {
    // Separador após "Sem status"
    if (i === 1) {
      const sep = document.createElement('div');
      sep.className = 'status-dropdown-sep';
      dropdown.appendChild(sep);
    }

    const btn = document.createElement('button');
    btn.className = 'status-dropdown-item' + (opt.value === current ? ' is-active' : '');
    btn.innerHTML =
      `<span class="status-dropdown-dot" style="background:${opt.hex}"></span>
       ${opt.label}`;
    btn.onclick = (e) => {
      e.stopPropagation();
      applyStatus(opt.value);
    };
    dropdown.appendChild(btn);
  });

  dropdown.classList.remove('hidden');
  wrap.classList.add('is-open');
  _dropdownOpen = true;

  // Fecha ao clicar fora
  setTimeout(() => document.addEventListener('click', _closeOnOutside), 0);
}

function closeStatusDropdown() {
  const wrap     = document.getElementById('statusWrap');
  const dropdown = document.getElementById('statusDropdown');
  dropdown.classList.add('hidden');
  wrap.classList.remove('is-open');
  _dropdownOpen = false;
  document.removeEventListener('click', _closeOnOutside);
}

function _closeOnOutside(e) {
  const wrap = document.getElementById('statusWrap');
  if (wrap && !wrap.contains(e.target)) closeStatusDropdown();
}

/** Aplica um status diretamente (usado pelo dropdown) */
function applyStatus(value) {
  const day  = getDay(currentDate);
  day.status = value;   // null = sem status
  save();
  renderHeader();
  closeStatusDropdown();
}

// ══════════════════════════════════════════════
// METAS — CÁLCULO AUTOMÁTICO (Bloco 5B)
// ══════════════════════════════════════════════

/**
 * Retorna array de strings "YYYY-MM-DD" de todos os dias do período atual.
 * Semanal → segunda a domingo da semana corrente
 * Mensal  → do dia 1 ao último do mês corrente
 */
function getDiasDoPeriodo(periodo) {
  const now = new Date();
  const result = [];
  if (periodo === 'mensal') {
    const y = now.getFullYear(), m = now.getMonth();
    const total = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= total; d++)
      result.push(`${y}-${pad(m + 1)}-${pad(d)}`);
  } else {
    // semanal: segunda-feira da semana atual
    const dow = now.getDay(); // 0=dom
    const diff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(now);
    mon.setDate(now.getDate() + diff);
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      result.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }
  }
  return result;
}

/**
 * Calcula o progresso automático de uma meta auto-planner ou auto-recorrente
 * varrendo os dados existentes em appData.days.
 */
function calcAutoProgresso(meta) {
  const dias = getDiasDoPeriodo(meta.periodo);

  if (meta.autoFonte === 'grande-concluido') {
    // Conta dias em que o grande objetivo foi marcado como feito
    return dias.filter(d => appData.days[d]?.bigDone === true).length;
  }

  if (meta.autoFonte === 'status-dominado') {
    // Conta dias com status "dominado" (manual ou calculado)
    return dias.filter(d => {
      const day = appData.days[d];
      if (!day) return false;
      return (day.status || autoStatus(day)) === 'acao';
    }).length;
  }

  if (meta.autoFonte === 'tarefas-completas') {
    // Soma total de tarefas concluídas em todos os dias do período
    return dias.reduce((sum, d) => {
      const day = appData.days[d];
      if (!day) return sum;
      const done = (day.bigGoal && day.bigDone ? 1 : 0)
        + day.medium.filter(t => t.text && t.done).length
        + day.small.filter(t =>  t.text && t.done).length;
      return sum + done;
    }, 0);
  }

  if (meta.tipo === 'auto-recorrente' && meta.tarefaTexto) {
    // Conta dias em que a tarefa recorrente vinculada foi concluída
    const norm = meta.tarefaTexto.trim().toLowerCase();
    return dias.filter(d => {
      const day = appData.days[d];
      if (!day) return false;
      const bigMatch = day.bigGoal?.trim().toLowerCase() === norm && day.bigDone;
      const medMatch = day.medium.some(t => t.text?.trim().toLowerCase() === norm && t.done);
      const smlMatch = day.small.some(t =>  t.text?.trim().toLowerCase() === norm && t.done);
      return bigMatch || medMatch || smlMatch;
    }).length;
  }

  return 0;
}

/** Retorna tarefas recorrentes do backlog (para popular o select) */
function getRecorrenteTasks() {
  return appData.backlog.filter(t =>
    typeof t === 'object' && t.tipo === 'recorrente' && t.text
  );
}

/**
 * Mostra/oculta linhas do formulário de metas de acordo com o tipo selecionado.
 * Também popula o select de tarefas recorrentes quando necessário.
 */
function updateMetaForm() {
  const tipo      = getChipVal('tipo-meta', 'manual');
  const fonteRow  = document.getElementById('metaFonteRow');
  const tarefaRow = document.getElementById('metaTarefaRow');

  if (fonteRow)  fonteRow.style.display  = tipo === 'auto-planner'    ? '' : 'none';
  if (tarefaRow) tarefaRow.style.display = tipo === 'auto-recorrente' ? '' : 'none';

  // Popular select quando Recorrente é selecionado
  if (tipo === 'auto-recorrente') {
    const sel = document.getElementById('metaTarefaSelect');
    if (!sel) return;
    const recorrentes = getRecorrenteTasks();
    sel.innerHTML = recorrentes.length
      ? recorrentes.map(t =>
          `<option value="${escHtml(t.text)}">${escHtml(t.text)}</option>`
        ).join('')
      : '<option value="">— sem tarefas recorrentes no backlog —</option>';
  }
}

// ══════════════════════════════════════════════
// METAS (Bloco 5A)
// ══════════════════════════════════════════════

/**
 * Retorna a chave do período atual para comparação e reset automático.
 * Mensal  → "YYYY-MM"
 * Semanal → "YYYY-MM-DD" da segunda-feira da semana
 */
function periodoKey(periodo) {
  const now = new Date();
  if (periodo === 'mensal') {
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${m}`;
  }
  // semanal: volta até segunda-feira
  const day = now.getDay(); // 0=dom
  const diff = (day === 0) ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  const mm = String(mon.getMonth() + 1).padStart(2, '0');
  const dd = String(mon.getDate()).padStart(2, '0');
  return `${mon.getFullYear()}-${mm}-${dd}`;
}

/* ── Stepper do alvo ── */
function adjustMetaAlvo(delta) {
  _metaAlvo = Math.max(1, Math.min(99, _metaAlvo + delta));
  renderMetaAlvo();
}
function renderMetaAlvo() {
  const el = document.getElementById('metaAlvoDisplay');
  if (el) el.textContent = _metaAlvo;
}

/* ── Adicionar meta ── */
function addMeta() {
  const nome = (document.getElementById('metaNome').value || '').trim();
  if (!nome) { document.getElementById('metaNome').focus(); return; }

  const tipoMeta = getChipVal('tipo-meta', 'manual');
  const periodo  = getChipVal('periodo', 'semanal');
  const unidade  = (document.getElementById('metaUnidade').value || '').trim() || 'vezes';
  const chave    = periodoKey(periodo);

  const base = {
    id:           Date.now(),
    nome,
    alvo:         _metaAlvo,
    unidade,
    periodo,
    progresso:    0,
    periodoAtual: chave,
    criadoEm:     todayString()
  };

  if (tipoMeta === 'auto-recorrente') {
    const sel         = document.getElementById('metaTarefaSelect');
    const tarefaTexto = sel?.value?.trim() || '';
    if (!tarefaTexto) {
      // Sem tarefa selecionada — foca no select
      sel?.focus();
      return;
    }
    appData.metas.push({ ...base, tipo: 'auto-recorrente', autoFonte: null, tarefaTexto });

  } else if (tipoMeta === 'auto-planner') {
    const autoFonte = getChipVal('fonte', 'grande-concluido');
    appData.metas.push({ ...base, tipo: 'auto-planner', autoFonte, tarefaTexto: null });

  } else {
    // manual (padrão)
    appData.metas.push({ ...base, tipo: 'manual', autoFonte: null, tarefaTexto: null });
  }

  // Limpar form
  document.getElementById('metaNome').value    = '';
  document.getElementById('metaUnidade').value = '';
  _metaAlvo = 5;
  renderMetaAlvo();

  save();
  renderMetasView();
  updateMetasCount();
  showToast('✓ Meta criada', 'green');
}

/* ── Incrementar / decrementar progresso ── */
function updateProgresso(index, delta) {
  const m = appData.metas[index];
  if (!m) return;
  m.progresso = Math.max(0, Math.min(m.alvo * 2, m.progresso + delta));
  save();
  renderMetasView();
}

/* ── Remover meta ── */
function removeMeta(index) {
  appData.metas.splice(index, 1);
  save();
  renderMetasView();
  updateMetasCount();
  showToast('× Meta removida');
}

/* ── Atualiza badge de contagem ── */
function updateMetasCount() {
  const el = document.getElementById('metasCount');
  if (el) el.textContent = appData.metas.length;
}

/* ── Renderiza a view Metas ── */
function renderMetasView() {
  updateMetasCount();
  const list = document.getElementById('metasList');
  if (!list) return;

  if (!appData.metas.length) {
    list.innerHTML = '<p class="meta-empty">Nenhuma meta criada. Adicione metas manuais ou automáticas acima para acompanhar seu progresso.</p>';
    return;
  }

  // Aplica filtro de tipo de meta
  const metasFiltradas = appData.metas
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => {
      if (_metasFiltro === 'manual') return m.tipo === 'manual';
      if (_metasFiltro === 'auto')   return m.tipo === 'auto-planner' || m.tipo === 'auto-recorrente';
      return true;
    });

  if (metasFiltradas.length === 0) {
    const labels = { manual: 'manuais', auto: 'automáticas' };
    list.innerHTML = `<p class="meta-empty">Nenhuma meta ${labels[_metasFiltro] || ''} criada ainda.</p>`;
    return;
  }

  list.innerHTML = metasFiltradas.map(({ m, i }) => {
    // Auto-reset se mudou de período (só redefine progresso para metas manuais)
    const chaveAtual = periodoKey(m.periodo);
    if (m.periodoAtual !== chaveAtual) {
      m.periodoAtual = chaveAtual;
      if (m.tipo === 'manual') m.progresso = 0;
      save();
    }

    // Progresso: calculado automaticamente para auto, manual para o resto
    const isAuto   = m.tipo === 'auto-planner' || m.tipo === 'auto-recorrente';
    const progresso = isAuto ? calcAutoProgresso(m) : m.progresso;

    const pct      = Math.min(100, Math.round((progresso / m.alvo) * 100));
    const concluiu = progresso >= m.alvo;
    const barColor = concluiu ? 'var(--green)' : pct >= 50 ? 'var(--gold)' : 'var(--blue)';
    const periodoLabel = m.periodo === 'mensal' ? 'Mensal' : 'Semanal';

    // Badge de tipo
    let tipoBadge = '';
    if (m.tipo === 'auto-planner') {
      const fonteLabel = {
        'grande-concluido':  'Grande ✓',
        'status-dominado':   'Dominado',
        'tarefas-completas': 'Tarefas'
      }[m.autoFonte] || 'Auto';
      tipoBadge = `<span class="meta-tipo-badge is-auto">⚡ ${fonteLabel}</span>`;
    } else if (m.tipo === 'auto-recorrente') {
      tipoBadge = `<span class="meta-tipo-badge is-recorrente">🔗 ${escHtml(m.tarefaTexto || 'Recorrente')}</span>`;
    } else {
      tipoBadge = `<span class="meta-tipo-badge is-manual">✎ Manual</span>`;
    }

    // Controles: +/- apenas para metas manuais
    const ctrlHtml = isAuto
      ? `<p class="meta-auto-label">⚡ calculado do planner</p>`
      : `<div class="meta-ctrl-row">
           <button class="bal-btn meta-ctrl-btn" onclick="updateProgresso(${i},-1)">−</button>
           <span class="meta-ctrl-label">Registrar</span>
           <button class="bal-btn meta-ctrl-btn" onclick="updateProgresso(${i},1)">+</button>
         </div>`;

    return `
      <div class="meta-item ${concluiu ? 'is-done' : ''}">
        <div class="meta-item-top">
          <span class="meta-item-nome">${escHtml(m.nome)}</span>
          <button class="meta-remove-btn" onclick="removeMeta(${i})" aria-label="Remover">✕</button>
        </div>
        <div class="meta-item-sub">
          ${tipoBadge}
          <span class="meta-periodo-badge">${periodoLabel}</span>
          <span class="meta-item-num">${progresso} / ${m.alvo} ${escHtml(m.unidade)}</span>
          <span class="meta-pct">${pct}%</span>
        </div>
        <div class="meta-bar-wrap">
          <div class="meta-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        ${ctrlHtml}
      </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
// TOAST (Bloco 6B)
// ══════════════════════════════════════════════

/**
 * Exibe um feedback breve na parte inferior do app.
 * variant: '' | 'green' | 'blue' | 'red' | 'gold'
 */
function showToast(msg, variant) {
  const el = document.getElementById('appToast');
  if (!el) return;
  if (_toastTimer) clearTimeout(_toastTimer);
  el.textContent = msg;
  el.className   = `toast${variant ? ' is-' + variant : ''}`;
  void el.offsetWidth; // força reflow para reiniciar transição
  el.classList.add('is-visible');
  _toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2300);
}

// ══════════════════════════════════════════════
// FILTROS (Bloco 6B)
// ══════════════════════════════════════════════

/** Filtro do Backlog */
function setBacklogFiltro(val, btn) {
  _backlogFiltro = val;
  document.querySelectorAll('.ftab[data-filtro-group="backlog"]')
    .forEach(b => b.classList.remove('is-active'));
  if (btn) btn.classList.add('is-active');
  renderBacklog();
}

/** Filtro do Histórico */
function setRetroFiltro(val, btn) {
  _retroFiltro = val;
  document.querySelectorAll('.ftab[data-filtro-group="retro"]')
    .forEach(b => b.classList.remove('is-active'));
  if (btn) btn.classList.add('is-active');
  renderRetroView();
}

/** Filtro de Metas */
function setMetasFiltro(val, btn) {
  _metasFiltro = val;
  document.querySelectorAll('.ftab[data-filtro-group="metas"]')
    .forEach(b => b.classList.remove('is-active'));
  if (btn) btn.classList.add('is-active');
  renderMetasView();
}

// ══════════════════════════════════════════════
// SETTINGS / BACKUP — Bloco 7
// ══════════════════════════════════════════════

let _confirmCallback = null;  // callback aguardando confirmação do usuário
let _importParsed    = null;  // dados do arquivo importado aguardando confirmação

// ── Painel de configurações ──

function openSettings() {
  document.getElementById('settingsOverlay').classList.remove('hidden');
  document.getElementById('settingsPanel').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settingsOverlay').classList.add('hidden');
  document.getElementById('settingsPanel').classList.add('hidden');
}

// ── Exportação ──

/**
 * Exporta todos os dados do app como arquivo .json para download.
 */
function exportData() {
  const payload = {
    _app:           'Plannit',
    _schemaVersion: SCHEMA_VERSION,
    _exportedAt:    new Date().toISOString(),
    days:           appData.days,
    backlog:        appData.backlog,
    metas:          appData.metas
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `plannit-backup-${todayString()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  closeSettings();
  showToast('✓ Backup exportado', 'green');
}

// ── Importação ──

/**
 * Chamado ao selecionar arquivo no <input type="file">.
 * Faz parse + validação mínima e abre confirmação antes de restaurar.
 */
function importFileSelected(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (typeof data !== 'object' || data === null)        throw new Error('not object');
      if (!data.days && !data.backlog && !data.metas)       throw new Error('no plannit keys');
      _importParsed = data;
      closeSettings();
      openConfirmModal(
        'Restaurar backup?',
        `Os dados atuais serão substituídos pelo arquivo "${file.name}". Esta ação não pode ser desfeita.`,
        'Restaurar',
        _finishImport,
        false  // botão azul (ação segura)
      );
    } catch(err) {
      _importParsed = null;
      showToast('✗ Arquivo inválido ou corrompido', 'red');
    }
    input.value = ''; // permite re-selecionar o mesmo arquivo
  };
  reader.onerror = () => showToast('✗ Erro ao ler arquivo', 'red');
  reader.readAsText(file);
}

/** Finaliza a importação após confirmação do usuário. */
function _finishImport() {
  if (!_importParsed) return;
  try {
    appData = applyMigrations({
      days:    _importParsed.days    || {},
      backlog: _importParsed.backlog || [],
      metas:   _importParsed.metas   || []
    });
    _importParsed = null;
    save();
    currentDate = todayString();
    currentView = 'today';
    render();
    showToast('✓ Backup restaurado com sucesso', 'green');
  } catch(err) {
    _importParsed = null;
    showToast('✗ Falha ao restaurar backup', 'red');
  }
}

// ── Reset seguro ──

/** Abre confirmação para reset total do app. */
function confirmResetApp() {
  closeSettings();
  openConfirmModal(
    'Apagar todos os dados?',
    'Dias, backlog e metas serão apagados permanentemente. Esta ação não pode ser desfeita.',
    'Apagar tudo',
    _resetApp,
    true  // botão vermelho (ação destrutiva)
  );
}

/** Executa o reset — chamado apenas após confirmação explícita. */
function _resetApp() {
  appData     = { days: {}, backlog: [], metas: [] };
  currentDate = todayString();
  currentView = 'today';
  save();
  render();
  showToast('App reiniciado', 'red');
}

// ── Modal de confirmação genérico ──

/**
 * Abre o modal de confirmação com título, mensagem, rótulo do botão e callback.
 * isDanger=true → botão vermelho · isDanger=false → botão azul
 */
function openConfirmModal(title, msg, btnLabel, callback, isDanger) {
  _confirmCallback = callback;
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent   = msg;
  const btn = document.getElementById('confirmBtnOk');
  btn.textContent = btnLabel;
  btn.className   = isDanger ? 'confirm-btn-ok is-danger' : 'confirm-btn-ok';
  document.getElementById('confirmOverlay').classList.remove('hidden');
  document.getElementById('confirmModal').classList.remove('hidden');
}

/** Fecha o modal sem executar ação (cancelamento). */
function closeConfirmModal() {
  _confirmCallback = null;
  document.getElementById('confirmOverlay').classList.add('hidden');
  document.getElementById('confirmModal').classList.add('hidden');
}

/** Fecha e mostra toast de cancelamento (chamado pelo botão Cancelar e overlay). */
function cancelConfirmModal() {
  closeConfirmModal();
  showToast('Cancelado');
}

/** Executa o callback de confirmação e fecha o modal. */
function _runConfirmCallback() {
  const cb = _confirmCallback;
  closeConfirmModal(); // fecha sem toast
  if (cb) cb();
}

// ── Firebase: ações chamadas pelo HTML ──

/** Inicia login com Google */
function fbLoginAction() {
  closeSettings();
  if (window._fb?.login) window._fb.login();
  else showToast('Firebase ainda carregando…');
}

/** Faz logout */
function fbLogoutAction() {
  closeSettings();
  if (window._fb?.logout) window._fb.logout();
}

/**
 * Chamado pelo firebase-init.js quando dados remotos chegam.
 * Mescla: usa os dados remotos e salva localmente.
 */
window._fbMergeRemote = function(remoteData) {
  try {
    appData = applyMigrations({
      days:    remoteData.days    || {},
      backlog: remoteData.backlog || [],
      metas:   remoteData.metas   || []
    });
    // Salva localmente (sem triggering fbScheduleSave para evitar loop)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...appData, _schemaVersion: SCHEMA_VERSION }));
    render();
    showToast('☁ Dados sincronizados', 'blue');
  } catch(e) {
    console.error('_fbMergeRemote error', e);
  }
};

/** Chamado quando o sync está pronto (usuário logado + dados carregados) */
window._fbSyncReady = function() {
  const el = document.getElementById('syncIndicator');
  if (el) el.className = 'sync-indicator is-synced';
};

/** Chamado quando o sync é desativado (logout) */
window._fbSyncDisabled = function() {
  const el = document.getElementById('syncIndicator');
  if (el) el.className = 'sync-indicator';
};

// ══════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════

/** Escapa HTML para evitar XSS nos textos salvos */
function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════
// IA — Chat com assistente de planejamento
// ══════════════════════════════════════════════

let _iaHistory    = [];   // histórico da conversa atual (role + content)
let _iaLoading    = false;
let _iaMsgCounter = 0;    // ID único por mensagem

// ── Prompt do sistema ──────────────────────────
function buildIASystemPrompt() {
  const today    = todayString();
  const todayObj = parseLocal(today);
  const dayName  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][todayObj.getDay()];
  const todayDay = getDay(today);

  // Snapshot do backlog (máx 20 itens)
  const backlogSnap = (appData.backlog || []).slice(0, 20).map((t, i) => {
    const item = typeof t === 'string' ? { text: t } : t;
    return `  ${i + 1}. "${item.text}" [${item.porte || 'pequena'}, ${item.tipo || 'unica'}]`;
  }).join('\n') || '  (vazio)';

  // Snapshot do dia atual
  const bigGoal  = todayDay.bigGoal || '(nenhum)';
  const medTasks = (todayDay.medium || []).filter(t => t.text).map(t => `"${t.text}"`).join(', ') || '(nenhuma)';
  const smlTasks = (todayDay.small  || []).filter(t => t.text).map(t => `"${t.text}"`).join(', ') || '(nenhuma)';

  // Snapshot histórico últimos 5 dias
  const histSnap = Array.from({length: 5}, (_, i) => addDays(today, -(i + 1)))
    .map(d => {
      const dObj = appData.days[d];
      if (!dObj) return null;
      const p = calcProgress(dObj);
      const s = dObj.status ? STATUS_LABELS[dObj.status] : 'sem status';
      return `  ${d}: ${p.done}/${p.total} tarefas, ${s}`;
    })
    .filter(Boolean)
    .join('\n') || '  (sem histórico)';

  return `Você é a assistente de planejamento do Plannit, um planner pessoal diário.
Sua função é ajudar o usuário a organizar tarefas, planejar a semana e tomar decisões sobre prioridades.
Você é objetiva, prática e direta — sem frases motivacionais genéricas.

== CONTEXTO ATUAL DO APP ==
Data de hoje: ${dayName}, ${today}
Status do dia: ${todayDay.status ? STATUS_LABELS[todayDay.status] : 'sem status'}

Dia atual (1-3-5):
  Grande: ${bigGoal}
  Médias: ${medTasks}
  Pequenas: ${smlTasks}

Backlog (tarefas pendentes):
${backlogSnap}

Histórico recente:
${histSnap}

== ESTRUTURA DO PLANNIT ==
- 1 GRANDE: objetivo principal do dia (bloco maior, mais impactante)
- 3 MÉDIAS: tarefas de 1-2 horas cada
- 5 PEQUENAS: tarefas rápidas, 15-30 min
- BACKLOG: fila de tarefas pendentes aguardando ser alocadas em um dia
- STATUS DO DIA: Normal (verde), Ação & Foco (azul), Compromisso (vermelho), Cansativo (laranja), Relaxar (roxo), Neutro (amarelo)
- PORTE: grande / media / pequena
- TIPO: unica / recorrente

== SEU COMPORTAMENTO ==
1. Quando o usuário mencionar tarefas vagas ou grandes demais, PERGUNTE antes de propor plano.
   Exemplo: "gravar 20 vídeos" → pergunte se já estão gravados ou precisam ser produzidos.
2. Quando tiver clareza suficiente, monte uma proposta estruturada.
3. Ao propor tarefas para adicionar ao backlog, inclua SEMPRE um bloco JSON ao final da sua mensagem neste formato exato:

\`\`\`plannit-action
{
  "type": "add_to_backlog",
  "tasks": [
    {"text": "Nome da tarefa", "porte": "grande|media|pequena", "tipo": "unica|recorrente"},
    ...
  ]
}
\`\`\`

4. Se o usuário pedir para montar o dia (1-3-5), use o formato:

\`\`\`plannit-action
{
  "type": "set_day",
  "date": "YYYY-MM-DD",
  "big": "tarefa grande",
  "medium": ["tarefa média 1", "tarefa média 2", "tarefa média 3"],
  "small": ["tarefa pequena 1", "tarefa pequena 2", "tarefa pequena 3", "tarefa pequena 4", "tarefa pequena 5"]
}
\`\`\`

5. O bloco JSON deve aparecer APENAS quando você tiver uma proposta concreta para o usuário confirmar.
6. Nunca inclua o bloco se ainda estiver fazendo perguntas ou conversando.
7. Responda sempre em português do Brasil.
8. Seja conciso — respostas longas só quando necessário para planejar algo complexo.`;
}

// ── Render de mensagem ──────────────────────────
function iaRenderMessage(role, text, proposalData) {
  const list = document.getElementById('iaMessages');
  if (!list) return;

  const id = ++_iaMsgCounter;
  const wrap = document.createElement('div');
  wrap.className = `ia-msg ia-msg--${role}`;
  wrap.id = `ia-msg-${id}`;

  const now = new Date();
  const ts  = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // Remove bloco ```plannit-action``` do texto exibido
  const cleanText = text.replace(/```plannit-action[\s\S]*?```/g, '').trim();

  wrap.innerHTML = `
    <div class="ia-bubble">${cleanText.replace(/</g, '&lt;')}</div>
    <span class="ia-ts">${ts}</span>`;

  // Se vier com proposta de ação, renderiza o card abaixo da bolha
  if (proposalData) {
    wrap.appendChild(iaRenderProposal(proposalData, id));
  }

  list.appendChild(wrap);
  list.scrollTop = list.scrollHeight;
  return id;
}

// ── Card de proposta de ações ──────────────────
function iaRenderProposal(data, msgId) {
  const card = document.createElement('div');
  card.className = 'ia-proposal';
  card.id = `ia-proposal-${msgId}`;

  if (data.type === 'add_to_backlog') {
    const tasksHTML = (data.tasks || []).map(t => `
      <div class="ia-proposal-task">
        <span class="ia-proposal-task-text">${t.text.replace(/</g, '&lt;')}</span>
        <span class="ia-proposal-badge ia-badge--${t.porte || 'pequena'}">${t.porte || 'pequena'}</span>
        <span class="ia-proposal-badge ia-badge--${t.tipo || 'unica'}">${t.tipo === 'recorrente' ? '↻' : '1×'}</span>
      </div>`).join('');

    card.innerHTML = `
      <div class="ia-proposal-header">✦ Adicionar ao Backlog (${data.tasks.length} ${data.tasks.length === 1 ? 'tarefa' : 'tarefas'})</div>
      <div class="ia-proposal-tasks">${tasksHTML}</div>
      <div class="ia-proposal-actions">
        <button class="ia-action-btn ia-action-btn--confirm"
                onclick="iaConfirmBacklog(${msgId})">Confirmar e salvar</button>
        <button class="ia-action-btn ia-action-btn--dismiss"
                onclick="iaDismissProposal(${msgId})">Ignorar</button>
      </div>`;

  } else if (data.type === 'set_day') {
    const dateLabel = data.date === todayString() ? 'Hoje' : data.date;
    card.innerHTML = `
      <div class="ia-proposal-header">✦ Montar dia — ${dateLabel}</div>
      <div class="ia-proposal-tasks">
        <div class="ia-proposal-task">
          <span class="ia-proposal-task-text">🎯 ${(data.big || '').replace(/</g, '&lt;')}</span>
          <span class="ia-proposal-badge ia-badge--grande">Grande</span>
        </div>
        ${(data.medium || []).map(t => `
        <div class="ia-proposal-task">
          <span class="ia-proposal-task-text">${t.replace(/</g, '&lt;')}</span>
          <span class="ia-proposal-badge ia-badge--media">Média</span>
        </div>`).join('')}
        ${(data.small || []).map(t => `
        <div class="ia-proposal-task">
          <span class="ia-proposal-task-text">${t.replace(/</g, '&lt;')}</span>
          <span class="ia-proposal-badge ia-badge--pequena">Pequena</span>
        </div>`).join('')}
      </div>
      <div class="ia-proposal-actions">
        <button class="ia-action-btn ia-action-btn--confirm"
                onclick="iaConfirmSetDay(${msgId}, '${data.date}')">Aplicar ao dia</button>
        <button class="ia-action-btn ia-action-btn--dismiss"
                onclick="iaDismissProposal(${msgId})">Ignorar</button>
      </div>`;
  }

  return card;
}

// ── Indicador de "digitando" ───────────────────
function iaShowTyping() {
  const list = document.getElementById('iaMessages');
  const dot  = document.createElement('div');
  dot.className = 'ia-typing';
  dot.id = 'ia-typing-indicator';
  dot.innerHTML = '<span></span><span></span><span></span>';
  list.appendChild(dot);
  list.scrollTop = list.scrollHeight;
}
function iaHideTyping() {
  const dot = document.getElementById('ia-typing-indicator');
  if (dot) dot.remove();
}

// ── Chamada à API Groq (Llama 3.3 70B) ────────
async function callGroqAPI(messages) {
  const key = (GROQ_KEY || '').trim();
  if (!key || key === 'COLOQUE_SUA_CHAVE_AQUI') throw new Error('NO_KEY');

  const body = {
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: buildIASystemPrompt() },
      ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
    ],
    temperature: 0.7,
    max_tokens: 1500
  };

  const res = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify(body)
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Extrai JSON de ação da resposta ───────────
function iaExtractAction(text) {
  const match = text.match(/```plannit-action\s*([\s\S]*?)```/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); }
  catch { return null; }
}

// ── Envio de mensagem ──────────────────────────
async function sendIAMessage() {
  if (_iaLoading) return;
  const input = document.getElementById('iaInput');
  const text  = (input.value || '').trim();
  if (!text) return;

  const key = (GROQ_KEY || '').trim();
  if (!key || key === 'COLOQUE_SUA_CHAVE_AQUI') { initIAView(); return; }

  // Limpa input
  input.value = '';
  input.style.height = '';

  // Mostra mensagem do usuário
  iaRenderMessage('user', text);

  // Adiciona ao histórico
  _iaHistory.push({ role: 'user', content: text });

  // Loading
  _iaLoading = true;
  document.getElementById('iaSendBtn').disabled = true;
  iaShowTyping();

  try {
    const reply = await callGroqAPI(_iaHistory);
    iaHideTyping();

    // Extrai ação se houver
    const action = iaExtractAction(reply);

    // Adiciona resposta ao histórico (sem o bloco JSON)
    _iaHistory.push({ role: 'assistant', content: reply });

    // Renderiza
    iaRenderMessage('assistant', reply, action);

  } catch (err) {
    iaHideTyping();
    const msg = err.message === 'NO_KEY'
      ? 'Erro ao conectar com a IA. Tente novamente em instantes.'
      : `Erro ao conectar: ${err.message}`;
    iaRenderMessage('assistant', msg);
  } finally {
    _iaLoading = false;
    document.getElementById('iaSendBtn').disabled = false;
    document.getElementById('iaInput').focus();
  }
}

// ── Confirmações das propostas ─────────────────
function iaConfirmBacklog(msgId) {
  const proposal = document.getElementById(`ia-proposal-${msgId}`);
  if (!proposal) return;

  // Recupera dados da proposta via histórico
  const msg = _iaHistory.slice().reverse().find(m => m.role === 'assistant');
  if (!msg) return;
  const data = iaExtractAction(msg.content);
  if (!data || data.type !== 'add_to_backlog') return;

  // Adiciona ao backlog
  let added = 0;
  (data.tasks || []).forEach(t => {
    appData.backlog.push({ text: t.text, porte: t.porte || 'pequena', tipo: t.tipo || 'unica' });
    added++;
  });
  save();

  // Feedback visual no card
  proposal.innerHTML = `
    <div class="ia-proposal-header" style="color:var(--green)">
      ✓ ${added} ${added === 1 ? 'tarefa adicionada' : 'tarefas adicionadas'} ao backlog
    </div>`;

  // Resposta no chat
  setTimeout(() => {
    iaRenderMessage('assistant', `✓ ${added} ${added === 1 ? 'tarefa adicionada' : 'tarefas adicionadas'} ao backlog. Você pode enviá-las para um dia específico na aba Backlog.`);
  }, 300);
}

function iaConfirmSetDay(msgId, date) {
  const proposal = document.getElementById(`ia-proposal-${msgId}`);
  if (!proposal) return;

  const msg = _iaHistory.slice().reverse().find(m => m.role === 'assistant');
  if (!msg) return;
  const data = iaExtractAction(msg.content);
  if (!data || data.type !== 'set_day') return;

  const day = getDay(date);

  if (data.big)    { day.bigGoal = data.big; day.bigDone = false; }
  if (data.medium) data.medium.forEach((t, i) => { if (i < 3 && day.medium[i]) day.medium[i].text = t; });
  if (data.small)  data.small.forEach((t, i)  => { if (i < 5 && day.small[i])  day.small[i].text  = t; });
  save();

  proposal.innerHTML = `
    <div class="ia-proposal-header" style="color:var(--green)">
      ✓ Dia ${date === todayString() ? 'de hoje' : date} configurado
    </div>`;

  setTimeout(() => {
    iaRenderMessage('assistant', `✓ Dia configurado. Acesse a aba Hoje para ver e ajustar.`);
  }, 300);
}

function iaDismissProposal(msgId) {
  const proposal = document.getElementById(`ia-proposal-${msgId}`);
  if (proposal) {
    proposal.innerHTML = `<div class="ia-proposal-header" style="color:var(--text3)">Proposta ignorada</div>`;
  }
}

// ── Input: Enter envia, Shift+Enter quebra linha ─
function iaInputKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendIAMessage();
  }
}

// ── Auto-resize do textarea ────────────────────
function iaInputAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

// ── Inicializa a view da IA (mensagem de boas-vindas) ──
function initIAView() {
  const list = document.getElementById('iaMessages');
  if (!list || list.children.length > 0) return;

  const key = (GROQ_KEY || '').trim();

  if (!key || key === 'COLOQUE_SUA_CHAVE_AQUI') {
    list.innerHTML = `
      <div class="ia-no-key">
        <div class="ia-no-key-icon">✦</div>
        <div class="ia-no-key-title">Assistente de Planejamento</div>
        <div class="ia-no-key-sub">A IA precisa de uma chave de API para funcionar.<br>Configure a constante GROQ_KEY no arquivo js/app.js</div>
      </div>`;
    return;
  }

  // Boas-vindas com contexto do dia
  const today    = todayString();
  const todayObj = parseLocal(today);
  const dayName  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][todayObj.getDay()];
  const backlogCount = (appData.backlog || []).length;

  const greeting = backlogCount > 0
    ? `Oi! É ${dayName}. Você tem ${backlogCount} ${backlogCount === 1 ? 'tarefa' : 'tarefas'} no backlog.\n\nMe conta o que precisa fazer ou pede pra eu te ajudar a organizar.`
    : `Oi! É ${dayName}. Me conta o que você precisa fazer e eu te ajudo a organizar e estruturar tudo.`;

  iaRenderMessage('assistant', greeting);
}

// ══════════════════════════════════════════════
// TOUR ONBOARDING
// ══════════════════════════════════════════════

const TOUR_STEPS = [
  {
    target: null,
    title: 'Bem-vindo ao Plannit ✦',
    text: 'Este tour rápido vai te mostrar os principais recursos do app. Use os botões abaixo para navegar entre as etapas.',
    position: 'center',
    view: null
  },
  {
    target: '#card-focus',
    title: 'Foco do Dia',
    text: 'Defina uma grande meta para o dia — o seu objetivo mais importante. Marque como concluída ao final.',
    position: 'bottom',
    view: 'today'
  },
  {
    target: '#card-tasks',
    title: 'Objetivos 1·3·5',
    text: 'Organize seu dia com até 1 tarefa grande, 3 médias e 5 pequenas. O método 1·3·5 evita sobrecarga e mantém o foco.',
    position: 'bottom',
    view: 'today'
  },
  {
    target: '#card-balance',
    title: 'Equilíbrio 8·8·8',
    text: 'Gerencie as 24h do dia: 8h de trabalho, 8h pessoal e 8h de sono. Ajuste conforme sua rotina.',
    position: 'top',
    view: 'today'
  },
  {
    target: '#card-capture',
    title: 'Captura Rápida',
    text: 'Anote ideias, insights e lembretes instantaneamente. Depois você os move para o Backlog ou o dia certo.',
    position: 'top',
    view: 'today'
  },
  {
    target: '#statusWrap',
    title: 'Status do Dia',
    text: 'Classifique como está seu dia: Ação & Foco, Compromisso, Relaxar... Isso alimenta o histórico e as metas automáticas.',
    position: 'bottom',
    view: 'today'
  },
  {
    target: '#tab-plan',
    title: 'Planejar',
    text: 'Visualize o calendário e distribua tarefas entre os dias da semana. Clique em qualquer dia para detalhar.',
    position: 'top',
    view: null
  },
  {
    target: '#tab-backlog',
    title: 'Backlog',
    text: 'Seu repositório de tarefas pendentes. Adicione, organize por porte e tipo, e mova para o dia certo quando quiser.',
    position: 'top',
    view: null
  },
  {
    target: '#tab-retro',
    title: 'Histórico',
    text: 'Veja sua retrospectiva: dias fechados, streak de produtividade e padrões ao longo do tempo.',
    position: 'top',
    view: null
  },
  {
    target: '#tab-metas',
    title: 'Metas',
    text: 'Crie metas semanais ou mensais — manuais ou automáticas (contam tarefas concluídas automaticamente).',
    position: 'top',
    view: null
  },
  {
    target: '#tab-ia',
    title: 'Assistente IA ✦',
    text: 'Seu co-piloto de planejamento. Descreva sua semana, peça sugestões ou organize seu backlog com linguagem natural.',
    position: 'top',
    view: null
  },
  {
    target: null,
    title: 'Tudo pronto! 🎯',
    text: 'Você conhece o Plannit. Comece definindo seu Foco do Dia e boa execução! Você pode rever o tour a qualquer momento em Configurações.',
    position: 'center',
    view: null
  }
];

let _tourStep = 0;
let _tourActive = false;
let _tourPrevTarget = null;

function tourStart(force = false) {
  if (!force && localStorage.getItem('plannit_tour_done') === '1') return;
  _tourStep = 0;
  _tourActive = true;
  _renderTourStep();
}

function tourNext() {
  if (!_tourActive) return;
  if (_tourStep >= TOUR_STEPS.length - 1) {
    tourEnd();
    return;
  }
  _tourStep++;
  _renderTourStep();
}

function tourPrev() {
  if (!_tourActive || _tourStep <= 0) return;
  _tourStep--;
  _renderTourStep();
}

function tourSkip() {
  tourEnd();
}

function tourEnd() {
  _tourActive = false;
  localStorage.setItem('plannit_tour_done', '1');

  // Remove elevação do target anterior
  if (_tourPrevTarget) {
    _tourPrevTarget.classList.remove('tour-target-elevated');
    _tourPrevTarget = null;
  }

  // Esconde todos os elementos do tour
  document.getElementById('tourOverlay').classList.add('hidden');
  document.getElementById('tourSpotlight').classList.add('hidden');
  document.getElementById('tourPopup').classList.add('hidden');
}

function _renderTourStep() {
  const step = TOUR_STEPS[_tourStep];

  // Navega para a view correta se necessário
  if (step.view && step.view !== currentView) {
    switchView(step.view);
  }

  // Remove elevação do target anterior
  if (_tourPrevTarget) {
    _tourPrevTarget.classList.remove('tour-target-elevated');
    _tourPrevTarget = null;
  }

  const overlay   = document.getElementById('tourOverlay');
  const spotlight = document.getElementById('tourSpotlight');
  const popup     = document.getElementById('tourPopup');

  // Atualiza textos
  document.getElementById('tourPopupTitle').textContent = step.title;
  document.getElementById('tourPopupText').textContent  = step.text;
  document.getElementById('tourStepCount').textContent  =
    `${_tourStep + 1} de ${TOUR_STEPS.length}`;

  // Dots de progresso
  const dotsEl = document.getElementById('tourDots');
  dotsEl.innerHTML = '';
  TOUR_STEPS.forEach((_, i) => {
    const d = document.createElement('span');
    d.className = 'tour-dot' + (i === _tourStep ? ' is-active' : '');
    dotsEl.appendChild(d);
  });

  // Botões
  const prevBtn = document.getElementById('tourPrevBtn');
  const nextBtn = document.getElementById('tourNextBtn');
  prevBtn.disabled = (_tourStep === 0);
  const isLast = (_tourStep === TOUR_STEPS.length - 1);
  nextBtn.textContent = isLast ? 'Concluir ✓' : 'Próximo →';
  nextBtn.className   = 'tour-btn tour-btn-next' + (isLast ? ' is-finish' : '');

  // Mostra overlay
  overlay.classList.remove('hidden');
  popup.classList.remove('hidden');

  if (!step.target) {
    // Passo centralizado — sem spotlight
    spotlight.classList.add('hidden');
    _positionPopupCenter(popup);
    return;
  }

  // Busca o elemento alvo (com pequeno delay para views recém-abertas renderizarem)
  setTimeout(() => {
    const el = document.querySelector(step.target);
    if (!el) {
      spotlight.classList.add('hidden');
      _positionPopupCenter(popup);
      return;
    }

    // Eleva o elemento acima do overlay
    el.classList.add('tour-target-elevated');
    _tourPrevTarget = el;

    // Posiciona spotlight
    _positionSpotlight(spotlight, el);
    spotlight.classList.remove('hidden');

    // Posiciona popup
    _positionPopup(popup, el, step.position);
  }, step.view ? 120 : 0);
}

function _positionSpotlight(spotlight, el) {
  const PAD = 8;
  const r   = el.getBoundingClientRect();
  spotlight.style.top    = (r.top  - PAD) + 'px';
  spotlight.style.left   = (r.left - PAD) + 'px';
  spotlight.style.width  = (r.width  + PAD * 2) + 'px';
  spotlight.style.height = (r.height + PAD * 2) + 'px';
}

function _positionPopup(popup, el, position) {
  const GAP     = 16;
  const PAD     = 16;
  const r       = el.getBoundingClientRect();
  const pw      = popup.offsetWidth  || 340;
  const ph      = popup.offsetHeight || 200;
  const vw      = window.innerWidth;
  const vh      = window.innerHeight;

  let top, left;

  if (position === 'bottom') {
    top  = r.bottom + GAP;
    left = r.left + r.width / 2 - pw / 2;
    // Se não cabe embaixo, coloca em cima
    if (top + ph > vh - PAD) top = r.top - ph - GAP;
  } else {
    top  = r.top - ph - GAP;
    left = r.left + r.width / 2 - pw / 2;
    // Se não cabe em cima, coloca embaixo
    if (top < PAD) top = r.bottom + GAP;
  }

  // Clamp horizontal
  left = Math.max(PAD, Math.min(left, vw - pw - PAD));
  // Clamp vertical
  top  = Math.max(PAD, Math.min(top, vh - ph - PAD));

  popup.style.top  = top  + 'px';
  popup.style.left = left + 'px';
}

function _positionPopupCenter(popup) {
  const pw = popup.offsetWidth  || 340;
  const ph = popup.offsetHeight || 200;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  popup.style.top  = ((vh - ph) / 2) + 'px';
  popup.style.left = ((vw - pw) / 2) + 'px';
}

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════

function init() {
  load();
  // Garante dia de hoje no data
  getDay(todayString());
  render();
  // Tour na primeira visita (delay para o render terminar)
  setTimeout(() => tourStart(false), 600);
}

// Inicia quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', init);
