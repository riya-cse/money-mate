/* MONEY MATE — application logic
   Amounts are stored in INR (base). Currency only changes DISPLAY and input conversion,
   so switching currencies never re-converts saved data. */
'use strict';

const KEY = 'moneymate2';
const SYM = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
const RATE = { INR: 1, USD: 88, EUR: 103, GBP: 119, JPY: 0.56 }; // INR per 1 unit
const LOC = { INR: 'en-IN', USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB', JPY: 'ja-JP' };
const THEMES = ['matcha', 'blossom', 'lavender', 'sky', 'sunshine'];
const DEFAULT_CATS = {
  expense: [['Food', 'fa-bowl-food'], ['Shopping', 'fa-basket-shopping'], ['Transport', 'fa-bus'], ['Bills', 'fa-file-invoice-dollar'],
            ['Entertainment', 'fa-film'], ['Education', 'fa-graduation-cap'], ['Health', 'fa-heart-pulse'], ['Other', 'fa-tag']],
  income: [['Salary', 'fa-sack-dollar'], ['Freelance', 'fa-laptop'], ['Allowance', 'fa-hand-holding-dollar'], ['Gift', 'fa-gift'], ['Other', 'fa-tag']]
};

const $ = id => document.getElementById(id);
const esc = s => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
const r4 = n => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

/* ---------- State & storage ---------- */
function freshState() {
  return {
    profile: { name: '', currency: 'INR', theme: 'matcha' },
    transactions: [], duePayments: [], monthlyBudget: 0, categoryBudgets: {},
    customCategories: { expense: [], income: [] }
  };
}
function loadState() {
  const s = freshState();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && typeof raw === 'object') {
      Object.assign(s.profile, raw.profile || {});
      if (Array.isArray(raw.transactions)) s.transactions = raw.transactions.filter(t => t && t.id && Number.isFinite(t.amount));
      if (Array.isArray(raw.duePayments)) s.duePayments = raw.duePayments.filter(d => d && d.id && Number.isFinite(d.amount));
      s.monthlyBudget = Number.isFinite(raw.monthlyBudget) && raw.monthlyBudget > 0 ? raw.monthlyBudget : 0;
      if (raw.categoryBudgets && typeof raw.categoryBudgets === 'object') s.categoryBudgets = raw.categoryBudgets;
      if (raw.customCategories) {
        ['expense', 'income'].forEach(k => { if (Array.isArray(raw.customCategories[k])) s.customCategories[k] = raw.customCategories[k]; });
      }
    }
  } catch (e) { /* corrupted storage: start empty rather than crash */ }
  if (!RATE[s.profile.currency]) s.profile.currency = 'INR';
  if (!THEMES.includes(s.profile.theme)) s.profile.theme = 'matcha';
  return s;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full/blocked */ } }

let S = loadState();
const UI = { range: 'month', txRange: 'month', from: '', to: '', type: 'all', sort: 'date-desc', search: '', dueFilter: 'unpaid', pending: null, catType: 'expense' };
let trendChart = null, catChart = null;

/* ---------- Dates (LOCAL time — never toISOString, which shifts days in IST) ---------- */
const pad = n => String(n).padStart(2, '0');
const toIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => toIso(new Date());
const parseIso = iso => new Date(iso + 'T00:00:00');
const addDays = (iso, n) => { const d = parseIso(iso); d.setDate(d.getDate() + n); return toIso(d); };
const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);
const fmtDate = iso => parseIso(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Periods run start..end of the calendar period (week = Mon–Sun) so every screen agrees.
function bounds(range, from, to) {
  const now = new Date(), t = todayIso();
  if (range === 'today') return { start: t, end: t };
  if (range === 'week') { const s = addDays(t, -((now.getDay() + 6) % 7)); return { start: s, end: addDays(s, 6) }; }
  if (range === 'month') return { start: toIso(new Date(now.getFullYear(), now.getMonth(), 1)), end: toIso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  if (range === 'year') return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` };
  if (range === 'custom' && from && to) return { start: from, end: to };
  return null; // all time
}
const inRange = (d, b) => !b || (d >= b.start && d <= b.end);
const sum = list => r4(list.reduce((s, t) => s + t.amount, 0));
const ofType = (list, type) => list.filter(t => t.type === type);

/* ---------- Currency ---------- */
const cur = () => S.profile.currency;
const toBase = v => r4(Number(v) * RATE[cur()]);
function fmt(base) {
  const c = cur(), d = c === 'JPY' ? 0 : 2;
  let v = (Number(base) || 0) / RATE[c];
  if (Math.abs(v) < (d ? 0.005 : 0.5)) v = 0;
  return (v < 0 ? '-' : '') + SYM[c] + Math.abs(v).toLocaleString(LOC[c], { minimumFractionDigits: d, maximumFractionDigits: d });
}
// Input value must not round away stored precision, or edit→save would change the amount.
const toInput = base => String(r4(base / RATE[cur()]));
const pctText = p => (Number.isFinite(p) ? String(Math.round(p * 10) / 10) : '0') + '%';

/* ---------- Categories ---------- */
function categories(type) {
  const defaults = DEFAULT_CATS[type].map(([name, icon]) => ({ name, icon, isDefault: true }));
  return defaults.concat((S.customCategories[type] || []).map(c => ({ name: c.name, icon: 'fa-tag', isDefault: false, id: c.id })));
}
const catIcon = (name, type) => (categories(type).find(c => c.name === name) || { icon: 'fa-tag' }).icon;
function fillSelect(id, type, withNone) {
  const el = $(id), keep = el.value;
  el.innerHTML = (withNone ? '<option value="">None</option>' : '') + categories(type).map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  if ([...el.options].some(o => o.value === keep)) el.value = keep;
}

/* ---------- Toast & modals ---------- */
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2400);
}
function openModal(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
function closeModal(id) {
  $(id).hidden = true;
  if (![...document.querySelectorAll('.modal-overlay')].some(m => !m.hidden)) document.body.style.overflow = '';
}
function confirmBox(title, msg, okLabel, fn) {
  $('confirmTitle').textContent = title; $('confirmMessage').textContent = msg; $('confirmOkBtn').textContent = okLabel;
  UI.pending = fn; openModal('confirmModal');
}
function setToggle(modalId, attr, value) {
  document.querySelectorAll(`#${modalId} .type-btn`).forEach(b => b.classList.toggle('is-active', b.dataset[attr] === value));
}

/* ---------- Rendering ---------- */
function emptyState(icon, text, cta) {
  const w = document.createElement('div'); w.className = 'empty-state';
  w.innerHTML = `<i class="fa-solid ${icon}"></i><p>${text}</p>${cta ? '<button class="primary-btn" data-open="tx"><i class="fa-solid fa-plus"></i> Add transaction</button>' : ''}`;
  return w;
}
function txList(el, list, emptyText, cta) {
  el.innerHTML = '';
  if (!list.length) { el.appendChild(emptyState('fa-seedling', emptyText, cta)); return; }
  list.forEach(t => {
    const row = document.createElement('div');
    row.className = 'tx-row' + (t.type === 'income' ? ' is-income' : '');
    row.innerHTML = `
      <div class="tx-icon"><i class="fa-solid ${catIcon(t.category, t.type)}"></i></div>
      <div class="tx-info"><p class="tx-name">${esc(t.description)}</p><p class="tx-meta">${esc(t.category)} · ${fmtDate(t.date)}${t.note ? ' · ' + esc(t.note) : ''}</p></div>
      <div class="tx-amount ${t.type === 'income' ? 'is-income' : 'is-expense'}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</div>
      <div class="tx-actions">
        <button data-edit-tx="${t.id}" aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
        <button data-del-tx="${t.id}" aria-label="Delete"><i class="fa-solid fa-trash-can"></i></button>
      </div>`;
    el.appendChild(row);
  });
}
const byDateDesc = (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id);

function dueStatus(d) {
  if (d.paid) return { cls: 'is-paid', text: 'Paid' };
  const n = daysBetween(todayIso(), d.dueDate);
  if (n < 0) return { cls: 'is-overdue', text: 'Overdue' };
  if (n === 0) return { cls: 'is-soon', text: 'Due today' };
  return { cls: n <= 3 ? 'is-soon' : '', text: `Due in ${n}d` };
}
function dueList(el, list, emptyText) {
  el.innerHTML = '';
  if (!list.length) { el.appendChild(emptyState('fa-calendar-check', emptyText, false)); return; }
  list.forEach(d => {
    const st = dueStatus(d), row = document.createElement('div');
    row.className = 'due-row';
    row.innerHTML = `
      <div class="tx-icon"><i class="fa-solid ${d.category ? catIcon(d.category, 'expense') : 'fa-calendar-day'}"></i></div>
      <div class="due-info"><p class="due-name">${esc(d.name)}</p><p class="due-meta">${fmt(d.amount)}${d.category ? ' · ' + esc(d.category) : ''} · ${fmtDate(d.dueDate)}</p></div>
      <span class="due-badge ${st.cls}">${st.text}</span>
      <div class="due-actions">
        ${d.paid ? '' : `<button data-paid="${d.id}" aria-label="Mark paid"><i class="fa-solid fa-check"></i></button>`}
        <button data-edit-due="${d.id}" aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
        <button data-del-due="${d.id}" aria-label="Delete"><i class="fa-solid fa-trash-can"></i></button>
      </div>`;
    el.appendChild(row);
  });
}

const RANGE_NAME = { today: 'today', week: 'this week', month: 'this month', year: 'this year' };
function monthSpent(name) {
  const b = bounds('month');
  return sum(S.transactions.filter(t => t.type === 'expense' && inRange(t.date, b) && (!name || t.category === name)));
}
// Shared budget math: returns safe numbers (no NaN/Infinity when budget is 0).
function budgetInfo(budget, spent) {
  const pct = budget > 0 ? (spent / budget) * 100 : 0;
  return { pct, bar: Math.min(100, pct), remaining: r4(budget - spent), over: budget > 0 && spent > budget, near: budget > 0 && spent <= budget && pct >= 80 };
}
const barClass = i => 'progress-fill' + (i.over ? ' is-over' : i.near ? ' is-warning' : '');

function renderDashboard() {
  const b = bounds(UI.range), inRng = S.transactions.filter(t => inRange(t.date, b));
  const income = sum(ofType(inRng, 'income')), expense = sum(ofType(inRng, 'expense'));
  $('statBalance').textContent = fmt(sum(ofType(S.transactions, 'income')) - sum(ofType(S.transactions, 'expense')));
  $('statIncome').textContent = fmt(income);
  $('statExpense').textContent = fmt(expense);
  $('labelIncome').textContent = 'Income ' + RANGE_NAME[UI.range];
  $('labelExpense').textContent = 'Expenses ' + RANGE_NAME[UI.range];

  const spent = monthSpent(), info = budgetInfo(S.monthlyBudget, spent);
  $('statBudget').textContent = fmt(S.monthlyBudget);
  $('dashBudgetFill').style.width = info.bar + '%';
  $('dashBudgetFill').className = barClass(info);
  $('dashBudgetCaption').textContent = S.monthlyBudget > 0 ? `${fmt(spent)} spent · ${pctText(info.pct)} used` : 'No budget set';

  txList($('dashRecentList'), [...S.transactions].sort(byDateDesc).slice(0, 5), 'Your wallet is waiting for its first entry', true);
  dueList($('dashDueList'), S.duePayments.filter(d => !d.paid).sort((a, c) => a.dueDate.localeCompare(c.dueDate)).slice(0, 3), 'No upcoming payments — nice and clear.');
  renderCharts(income, expense, ofType(inRng, 'expense'));
}

function renderTransactions() {
  const b = bounds(UI.txRange, UI.from, UI.to), q = UI.search.trim().toLowerCase();
  let list = S.transactions.filter(t => inRange(t.date, b) && (UI.type === 'all' || t.type === UI.type) &&
    (!q || t.description.toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || t.category.toLowerCase().includes(q)));
  list.sort((a, c) => UI.sort === 'date-asc' ? -byDateDesc(a, c) : UI.sort === 'amount-desc' ? c.amount - a.amount : UI.sort === 'amount-asc' ? a.amount - c.amount : byDateDesc(a, c));
  $('txSummary').textContent = list.length ? `${list.length} shown · Income ${fmt(sum(ofType(list, 'income')))} · Expenses ${fmt(sum(ofType(list, 'expense')))}` : '';
  txList($('txFullList'), list, S.transactions.length ? 'No transactions match these filters' : 'Your wallet is waiting for its first entry', !S.transactions.length);
}

function renderBudget() {
  const spent = monthSpent(), B = S.monthlyBudget, info = budgetInfo(B, spent);
  $('budgetAmount').textContent = B > 0 ? fmt(B) : 'No budget set';
  $('budgetBtnLabel').textContent = B > 0 ? 'Edit budget' : 'Set budget';
  $('budgetSpent').textContent = fmt(spent);
  $('budgetRemaining').textContent = B > 0 ? fmt(info.remaining) : fmt(0);
  $('budgetPercent').textContent = pctText(info.pct);
  $('budgetFill').style.width = info.bar + '%';
  $('budgetFill').className = barClass(info);
  const m = $('budgetMessage');
  m.hidden = !(info.over || info.near);
  if (info.over) { m.className = 'budget-message is-over'; m.textContent = "You've gone over this month's budget — no worries, a small trim will bring it back in line."; }
  else if (info.near) { m.className = 'budget-message is-warning'; m.textContent = "You're getting close to this month's budget. A little mindful spending will keep you on track."; }

  const grid = $('categoryBudgetGrid'); grid.innerHTML = '';
  categories('expense').forEach(c => {
    const cb = S.categoryBudgets[c.name] || 0, sp = monthSpent(c.name), ci = budgetInfo(cb, sp);
    const card = document.createElement('div'); card.className = 'cat-budget-card';
    card.innerHTML = `
      <div class="cat-budget-head"><span class="cat-budget-icon"><i class="fa-solid ${c.icon}"></i></span><span class="cat-budget-name">${esc(c.name)}</span>
        <button class="mini-btn" data-cat-budget="${esc(c.name)}">${cb > 0 ? 'Edit' : 'Set budget'}</button></div>
      ${cb > 0 ? `<div class="progress-track"><div class="${barClass(ci)}" style="width:${ci.bar}%"></div></div>
        <div class="cat-budget-stats"><span>Budget <strong>${fmt(cb)}</strong></span><span>Spent <strong>${fmt(sp)}</strong></span><span>Left <strong>${fmt(ci.remaining)}</strong></span><span><strong>${pctText(ci.pct)}</strong></span></div>`
        : `<p class="cat-note">Spent this month: <strong>${fmt(sp)}</strong></p>`}`;
    grid.appendChild(card);
  });

  const chips = $('categoryChips'); chips.innerHTML = '';
  [['expense', 'Expense categories'], ['income', 'Income categories']].forEach(([type, title]) => {
    chips.insertAdjacentHTML('beforeend', `<p class="chip-group-title">${title}</p><div class="chip-list">${categories(type).map(c =>
      `<span class="chip">${esc(c.name)}${c.isDefault ? '' : `<button data-del-cat="${c.id}" data-cat-type="${type}" aria-label="Delete ${esc(c.name)}"><i class="fa-solid fa-xmark"></i></button>`}</span>`).join('')}</div>`);
  });
}

function renderDue() {
  let list = [...S.duePayments];
  if (UI.dueFilter === 'unpaid') list = list.filter(d => !d.paid);
  if (UI.dueFilter === 'paid') list = list.filter(d => d.paid);
  list.sort((a, c) => a.dueDate.localeCompare(c.dueDate));
  dueList($('duePaymentsFullList'), list, UI.dueFilter === 'paid' ? 'No paid payments yet.' : 'Nothing due right now — enjoy the calm.');
}

function renderProfile() {
  const initial = (S.profile.name.trim().charAt(0) || 'M').toUpperCase();
  $('profileAvatar').textContent = initial; $('avatarInitial').textContent = initial;
  if (document.activeElement !== $('profileName')) $('profileName').value = S.profile.name;
  $('currencySelect').value = cur();
  document.querySelectorAll('.theme-swatch').forEach(b => b.classList.toggle('is-active', b.dataset.theme === S.profile.theme));
  const h = new Date().getHours();
  $('greetingText').textContent = (h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening') + (S.profile.name ? `, ${S.profile.name}!` : '!');
}

function renderNotifications() {
  const items = [], t = todayIso();
  S.duePayments.filter(d => !d.paid).forEach(d => {
    const n = daysBetween(t, d.dueDate);
    if (n < 0) items.push(['fa-triangle-exclamation', `${d.name} is overdue by ${-n} day${n === -1 ? '' : 's'}.`]);
    else if (n <= 3) items.push(['fa-calendar-day', `${d.name} is due ${n === 0 ? 'today' : `in ${n} day${n === 1 ? '' : 's'}`}.`]);
  });
  const info = budgetInfo(S.monthlyBudget, monthSpent());
  if (info.over) items.push(['fa-seedling', "You've gone over your monthly budget."]);
  else if (info.near) items.push(['fa-seedling', "You're close to your monthly budget."]);
  $('notifDot').hidden = $('mobileNotifDot').hidden = !items.length;
  $('notifPanel').innerHTML = items.length
    ? items.map(([i, tx]) => `<div class="notif-item"><i class="fa-solid ${i}"></i><span>${esc(tx)}</span></div>`).join('')
    : '<div class="notif-empty">All quiet — no reminders right now 🌱</div>';
}

function renderAll() {
  renderDashboard(); renderTransactions(); renderBudget(); renderDue(); renderProfile(); renderNotifications();
}

/* ---------- Charts (colors read live from CSS variables) ---------- */
const themeColor = n => getComputedStyle(document.body).getPropertyValue(n).trim();
function hueOf(hex) {
  const n = parseInt(hex.replace('#', ''), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
function renderCharts(income, expense, expenses) {
  if (typeof Chart === 'undefined') return; // CDN blocked: rest of app still works
  const ink = themeColor('--ink-soft'), grid = themeColor('--border'), inc = themeColor('--income'), exp = themeColor('--expense');
  const c = cur(), div = RATE[c], symbol = SYM[c];
  const money = v => symbol + Number(v).toLocaleString(LOC[c], { maximumFractionDigits: c === 'JPY' ? 0 : 2 });
  const vals = [income / div, expense / div];

  if (trendChart) trendChart.destroy();
  trendChart = new Chart($('trendChart').getContext('2d'), {
    type: 'bar',
    data: { labels: ['Income', 'Expenses'], datasets: [{ data: vals, backgroundColor: [inc, exp], borderRadius: 10, maxBarThickness: 90, minBarLength: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => ' ' + money(x.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink } },
        y: { beginAtZero: true, suggestedMax: Math.max(...vals) > 0 ? undefined : (c === 'JPY' ? 1000 : 100), grid: { color: grid }, ticks: { color: ink, callback: v => money(v) } }
      }
    }
  });

  const totals = {};
  expenses.forEach(t => { totals[t.category] = r4((totals[t.category] || 0) + t.amount); });
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]), total = entries.reduce((s, e) => s + e[1], 0);
  const hue = hueOf(themeColor('--accent-dark') || '#4F8A4A');
  const palette = entries.map((_, i) => `hsl(${(hue + i * 37) % 360} 55% ${i % 2 ? 62 : 70}%)`);
  $('catEmpty').hidden = entries.length > 0;
  if (catChart) catChart.destroy();
  catChart = new Chart($('categoryChart').getContext('2d'), {
    type: 'doughnut',
    data: entries.length
      ? { labels: entries.map(e => e[0]), datasets: [{ data: entries.map(e => e[1] / div), backgroundColor: palette, borderColor: themeColor('--surface'), borderWidth: 2 }] }
      : { labels: ['No data'], datasets: [{ data: [1], backgroundColor: [grid], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: { legend: { display: false }, tooltip: entries.length ? { callbacks: { label: x => ` ${x.label}: ${money(x.parsed)}` } } : { enabled: false } } }
  });
  $('categoryLegend').innerHTML = entries.map(([name, amt], i) =>
    `<div class="legend-row"><span class="legend-dot" style="background:${palette[i]}"></span><span class="legend-label">${esc(name)}</span><span class="legend-value">${fmt(amt)} · ${pctText(total ? amt / total * 100 : 0)}</span></div>`).join('');
}

/* ---------- Actions ---------- */
function openTx(id) {
  const tx = id ? S.transactions.find(t => t.id === id) : null;
  $('txForm').reset();
  $('txId').value = tx ? tx.id : '';
  $('txModalTitle').textContent = tx ? 'Edit transaction' : 'Add transaction';
  const type = tx ? tx.type : 'expense';
  setToggle('txModal', 'type', type); fillSelect('txCategory', type);
  if (tx) {
    $('txAmount').value = toInput(tx.amount); $('txCategory').value = tx.category;
    $('txDescription').value = tx.description; $('txDate').value = tx.date; $('txNote').value = tx.note || '';
  } else $('txDate').value = todayIso();
  openModal('txModal');
}
function saveTx() {
  const id = $('txId').value, type = document.querySelector('#txModal .type-btn.is-active').dataset.type;
  const entered = parseFloat($('txAmount').value), amount = toBase(entered);
  const rec = { type, amount, category: $('txCategory').value, description: $('txDescription').value.trim(), date: $('txDate').value, note: $('txNote').value.trim() };
  if (!(entered > 0) || !(amount > 0) || !rec.description || !rec.date || !rec.category) { toast('Please enter an amount above 0, a description and a date'); return; }
  if (id) { const tx = S.transactions.find(t => t.id === id); if (tx) Object.assign(tx, rec); toast('Transaction updated'); }
  else { S.transactions.push({ id: 'tx-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...rec }); toast('Transaction added'); }
  save(); renderAll(); closeModal('txModal');
}
function openDue(id) {
  const d = id ? S.duePayments.find(x => x.id === id) : null;
  $('dueForm').reset(); fillSelect('dueCategory', 'expense', true);
  $('dueId').value = d ? d.id : '';
  $('dueModalTitle').textContent = d ? 'Edit due payment' : 'Add due payment';
  if (d) { $('dueName').value = d.name; $('dueAmount').value = toInput(d.amount); $('dueDate').value = d.dueDate; $('dueCategory').value = d.category || ''; }
  else $('dueDate').value = addDays(todayIso(), 7);
  openModal('dueModal');
}
function saveDue() {
  const id = $('dueId').value, entered = parseFloat($('dueAmount').value), amount = toBase(entered);
  const rec = { name: $('dueName').value.trim(), amount, dueDate: $('dueDate').value, category: $('dueCategory').value };
  if (!rec.name || !(entered > 0) || !(amount > 0) || !rec.dueDate) { toast('Please fill in name, amount and date'); return; }
  if (id) { const d = S.duePayments.find(x => x.id === id); if (d) Object.assign(d, rec); toast('Payment updated'); }
  else { S.duePayments.push({ id: 'due-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...rec, paid: false }); toast('Payment added'); }
  save(); renderAll(); closeModal('dueModal');
}
function openBudget(catName) {
  $('budgetCatName').value = catName || '';
  $('budgetModalTitle').textContent = catName ? `${catName} budget` : 'Set monthly budget';
  const v = catName ? S.categoryBudgets[catName] : S.monthlyBudget;
  $('budgetInput').value = v > 0 ? toInput(v) : '';
  openModal('budgetModal');
}
function saveBudget() {
  const entered = parseFloat($('budgetInput').value), name = $('budgetCatName').value;
  if (!(entered >= 0)) { toast('Enter 0 or more'); return; }
  const v = toBase(entered);
  if (name) { if (v > 0) S.categoryBudgets[name] = v; else delete S.categoryBudgets[name]; }
  else S.monthlyBudget = v;
  save(); renderAll(); closeModal('budgetModal'); toast('Budget saved');
}
function saveCategory() {
  const name = $('catName').value.trim(), type = UI.catType;
  if (!name) return;
  if (categories(type).some(c => c.name.toLowerCase() === name.toLowerCase())) { toast('That category already exists'); return; }
  S.customCategories[type].push({ id: 'cat-' + Date.now().toString(36), name });
  save(); renderAll(); closeModal('catModal'); toast('Category added');
}
function deleteCategory(id, type) {
  const cat = S.customCategories[type].find(c => c.id === id); if (!cat) return;
  if (S.transactions.some(t => t.type === type && t.category === cat.name) || (type === 'expense' && S.duePayments.some(d => d.category === cat.name))) {
    toast("Can't delete — it's used by existing entries"); return;
  }
  S.customCategories[type] = S.customCategories[type].filter(c => c.id !== id);
  delete S.categoryBudgets[cat.name];
  save(); renderAll(); toast('Category deleted');
}
function applyTheme(name) {
  if (!THEMES.includes(name)) name = 'matcha';
  document.body.dataset.theme = name; S.profile.theme = name; save(); renderProfile(); renderDashboard();
}
function clearFinancialData() {
  const keep = S.profile; S = freshState(); S.profile = keep; // keeps theme, currency, name
  save(); renderAll(); toast('Financial data cleared');
}
function goPage(page, scrollTo) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('is-active', p.id === 'page-' + page));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('is-active', n.dataset.page === page && (!n.dataset.scroll || n.dataset.scroll === scrollTo)));
  $('sidebar').classList.remove('is-open'); $('sidebarOverlay').classList.remove('is-open');
  if (page === 'dashboard') renderDashboard();
  const target = scrollTo && $(scrollTo);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' }); else window.scrollTo({ top: 0 });
}

/* ---------- Events (all delegated: works for dynamically created buttons) ---------- */
document.addEventListener('click', e => {
  const q = sel => e.target.closest(sel);
  let el;
  if ((el = q('[data-page]'))) { goPage(el.dataset.page, el.dataset.scroll); return; }
  if ((el = q('[data-open]'))) {
    const w = el.dataset.open;
    if (w === 'tx') openTx(); else if (w === 'due') openDue(); else if (w === 'budget') openBudget();
    else if (w === 'cat') { $('catForm').reset(); UI.catType = 'expense'; setToggle('catModal', 'cattype', 'expense'); openModal('catModal'); }
    return;
  }
  if ((el = q('[data-close]'))) { closeModal(el.closest('.modal-overlay').id); return; }
  if (e.target.classList.contains('modal-overlay')) { closeModal(e.target.id); return; }
  if ((el = q('[data-edit-tx]'))) { openTx(el.dataset.editTx); return; }
  if ((el = q('[data-del-tx]'))) { const id = el.dataset.delTx; confirmBox('Delete transaction?', 'This will remove the transaction permanently.', 'Delete', () => { S.transactions = S.transactions.filter(t => t.id !== id); save(); renderAll(); toast('Transaction deleted'); }); return; }
  if ((el = q('[data-edit-due]'))) { openDue(el.dataset.editDue); return; }
  if ((el = q('[data-del-due]'))) { const id = el.dataset.delDue; confirmBox('Delete payment?', 'This will remove the due payment.', 'Delete', () => { S.duePayments = S.duePayments.filter(d => d.id !== id); save(); renderAll(); toast('Payment removed'); }); return; }
  if ((el = q('[data-paid]'))) { const d = S.duePayments.find(x => x.id === el.dataset.paid); if (d) { d.paid = true; save(); renderAll(); toast(`${d.name} marked as paid`); } return; }
  if ((el = q('[data-del-cat]'))) { const id = el.dataset.delCat, type = el.dataset.catType; confirmBox('Delete category?', 'Remove this custom category?', 'Delete', () => deleteCategory(id, type)); return; }
  if ((el = q('[data-cat-budget]'))) { openBudget(el.dataset.catBudget); return; }
  if ((el = q('#txModal .type-btn'))) { setToggle('txModal', 'type', el.dataset.type); fillSelect('txCategory', el.dataset.type); return; }
  if ((el = q('#catModal .type-btn'))) { UI.catType = el.dataset.cattype; setToggle('catModal', 'cattype', UI.catType); return; }
  if ((el = q('.theme-swatch'))) { applyTheme(el.dataset.theme); return; }
  if ((el = q('#dateFilter .seg-btn'))) { UI.range = el.dataset.range; document.querySelectorAll('#dateFilter .seg-btn').forEach(b => b.classList.toggle('is-active', b === el)); renderDashboard(); return; }
  if ((el = q('#dateFilterTx .seg-btn'))) {
    UI.txRange = el.dataset.range; document.querySelectorAll('#dateFilterTx .seg-btn').forEach(b => b.classList.toggle('is-active', b === el));
    $('customRangeRow').hidden = UI.txRange !== 'custom';
    if (UI.txRange !== 'custom') renderTransactions(); else if (UI.from && UI.to) renderTransactions();
    return;
  }
  if ((el = q('#dueFilter .seg-btn'))) { UI.dueFilter = el.dataset.dueFilter; document.querySelectorAll('#dueFilter .seg-btn').forEach(b => b.classList.toggle('is-active', b === el)); renderDue(); return; }
  if (q('#notifBtn') || q('#mobileNotifBtn')) { const p = $('notifPanel'); p.hidden = !p.hidden; $('notifBtn').setAttribute('aria-expanded', String(!p.hidden)); return; }
  if (!q('#notifPanel')) $('notifPanel').hidden = true;
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { document.querySelectorAll('.modal-overlay').forEach(m => { if (!m.hidden) closeModal(m.id); }); $('notifPanel').hidden = true; }
});

function wire() {
  $('mobileMenuBtn').addEventListener('click', () => { $('sidebar').classList.add('is-open'); $('sidebarOverlay').classList.add('is-open'); });
  $('sidebarOverlay').addEventListener('click', () => { $('sidebar').classList.remove('is-open'); $('sidebarOverlay').classList.remove('is-open'); });
  $('txForm').addEventListener('submit', e => { e.preventDefault(); saveTx(); });
  $('dueForm').addEventListener('submit', e => { e.preventDefault(); saveDue(); });
  $('budgetForm').addEventListener('submit', e => { e.preventDefault(); saveBudget(); });
  $('catForm').addEventListener('submit', e => { e.preventDefault(); saveCategory(); });
  $('confirmOkBtn').addEventListener('click', () => { const fn = UI.pending; UI.pending = null; closeModal('confirmModal'); if (typeof fn === 'function') fn(); });
  $('searchInput').addEventListener('input', e => { UI.search = e.target.value; renderTransactions(); });
  $('typeFilterSelect').addEventListener('change', e => { UI.type = e.target.value; renderTransactions(); });
  $('sortSelect').addEventListener('change', e => { UI.sort = e.target.value; renderTransactions(); });
  $('applyCustomRange').addEventListener('click', () => {
    let f = $('customFrom').value, t = $('customTo').value;
    if (!f || !t) { toast('Pick both a start and end date'); return; }
    if (f > t) [f, t] = [t, f];
    UI.from = f; UI.to = t; renderTransactions();
  });
  $('profileName').addEventListener('input', e => { S.profile.name = e.target.value.trim().slice(0, 30); save(); renderProfile(); });
  $('currencySelect').addEventListener('change', e => { if (RATE[e.target.value]) { S.profile.currency = e.target.value; save(); renderAll(); } });
  $('clearFinancialBtn').addEventListener('click', () => confirmBox('Clear financial data?',
    'This permanently removes your transactions, budgets, due payments and custom categories. Your theme, currency and name are kept.', 'Clear', clearFinancialData));
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.dataset.theme = S.profile.theme;
  fillSelect('txCategory', 'expense'); fillSelect('dueCategory', 'expense', true);
  wire(); renderAll();
});