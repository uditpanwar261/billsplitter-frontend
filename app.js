/**
 * BillSplitter  –  app.js
 * Full client-side controller: state, routing, API calls, rendering.
 * Connects to Flask backend via fetch().
 * Self-contained: works in a browser without a bundler (uses native modules).
 */

/* ─────────────────────────────────────────
   CONFIG
───────────────────────────────────────── */
const BASE = window.BS_API_BASE || 'http://localhost:5000/api';

/* ─────────────────────────────────────────
   TINY FETCH WRAPPER
───────────────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
const GET    = (p)       => api(p);
const POST   = (p, body) => api(p, { method: 'POST',   body });
const PUT    = (p, body) => api(p, { method: 'PUT',    body });
const DELETE = (p)       => api(p, { method: 'DELETE' });

/* ─────────────────────────────────────────
   STATE
───────────────────────────────────────── */
const State = {
  currentUser: null,           // logged-in member object
  members:     [],
  groups:      [],
  activeGroup: null,           // full group object with members
  activeGroupExpenses: [],
  activeGroupBalances: [],
  activeGroupSettlements: [],
  activeGroupSuggestions: [],
  activeGroupAnalytics: null,
  addExpForm: { cat: 'food', split: 'equal' },
};

/* ─────────────────────────────────────────
   ROUTER
───────────────────────────────────────── */
const SCREENS = ['home','groups','gdetail','analytics','settle','profile','login','register'];

function goTo(key) {
  // Auth guard — redirect to login if not signed in
  if (key !== 'login' && !State.currentUser) { key = 'login'; }

  SCREENS.forEach(s => {
    const el = document.getElementById('scr-' + s);
    if (el) el.classList.toggle('active', s === key);
  });
  updateNavActive(key);

  const loaders = {
    home:      loadHome,
    groups:    loadGroups,
    settle:    loadSettle,
    gdetail:   () => State.activeGroup && loadGroupDetail(State.activeGroup.id),
    analytics: () => State.activeGroup && loadAnalytics(State.activeGroup.id),
    profile:   loadProfile,
  };
  if (loaders[key]) loaders[key]().catch(e => showError(e.message));
}

function updateNavActive(key) {
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === key)
  );
}

/* ─────────────────────────────────────────
   TOAST / LOADER
───────────────────────────────────────── */
let _toastTimer;
function toast(msg, type = 'default') {
  const t = $('the-toast');
  t.textContent = msg;
  t.className = 'toast show' + (type === 'success' ? ' success' : type === 'error' ? ' error' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function setLoading(screenId, on) {
  const el = document.getElementById('loader-' + screenId);
  if (el) el.style.display = on ? 'flex' : 'none';
}

function showError(msg) { toast('⚠ ' + msg, 'error'); }

const $ = id => document.getElementById(id);

/* ─────────────────────────────────────────
   CLOCK + DATE
───────────────────────────────────────── */
function updateClock() {
  const n = new Date();
  const pad = v => String(v).padStart(2, '0');
  $('clock').textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}`;
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const lbl = $('today-label');
  if (lbl) lbl.textContent = days[n.getDay()];
}
updateClock();
setInterval(updateClock, 15000);

/* ─────────────────────────────────────────
   HOME SCREEN
───────────────────────────────────────── */
async function loadHome() {
  if (!State.currentUser) return;
  setLoading('home', true);
  try {
    // Aggregate balances across all groups the user belongs to
    const groups = await GET('/groups');
    State.groups = groups;

    let totalOwed = 0, totalOwes = 0;
    const recentExpenses = [];

    for (const g of groups) {
      const [balances, exps] = await Promise.all([
        GET(`/groups/${g.id}/balances`),
        GET(`/groups/${g.id}/expenses`),
      ]);
      const myBal = balances.find(b => b.member_id === State.currentUser.id);
      if (myBal) {
        if (myBal.balance > 0) totalOwed += myBal.balance;
        else totalOwes += Math.abs(myBal.balance);
      }
      exps.slice(0, 3).forEach(e => recentExpenses.push({ ...e, groupName: g.name }));
    }

    recentExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));

    const netBal = totalOwed - totalOwes;
    $('home-net-balance').textContent =
      (netBal >= 0 ? '+' : '') + '₹' + Math.abs(netBal).toFixed(2);
    $('home-net-balance').style.color = netBal >= 0 ? 'var(--green)' : 'var(--red)';
    $('home-owed').textContent = '₹' + totalOwed.toFixed(2);
    $('home-owes').textContent = '₹' + totalOwes.toFixed(2);
    renderRecentActivity(recentExpenses.slice(0, 6));
  } finally {
    setLoading('home', false);
  }
}

const CAT_EMOJI = { food:'🍕', transport:'🚕', home:'🏠', entertainment:'🎬',
                    accommodation:'🏨', travel:'✈️', other:'📦', general:'💰' };

function renderRecentActivity(expenses) {
  const wrap = $('recent-activity-list');
  if (!wrap) return;
  if (!expenses.length) {
    wrap.innerHTML = '<div style="text-align:center;color:var(--muted);padding:24px;font-size:13px">No expenses yet. Add one!</div>';
    return;
  }
  wrap.innerHTML = expenses.map(e => {
    const emoji = CAT_EMOJI[e.category] || '💰';
    const daysAgo = Math.floor((Date.now() - new Date(e.date)) / 86400000);
    const when = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;
    const myShare = (e.amount / 4).toFixed(2); // approx, real calc from balances
    const iGet = e.paid_by === State.currentUser?.id;
    return `
      <div class="act-item" onclick="openExpModal('${esc(e.id)}')">
        <div class="act-icon">${emoji}</div>
        <div class="act-info">
          <div class="act-name">${esc(e.description)}</div>
          <div class="act-meta">${when} · ${esc(e.groupName)}</div>
        </div>
        <div class="act-amounts">
          <div class="act-total">₹${Number(e.amount).toLocaleString('en-IN')}</div>
          <div class="act-you ${iGet?'g':'r'}">${iGet?'You paid':'₹'+myShare}</div>
        </div>
      </div>`;
  }).join('');
}

/* ─────────────────────────────────────────
   GROUPS SCREEN
───────────────────────────────────────── */
async function loadGroups() {
  setLoading('groups', true);
  try {
    const groups = await GET('/groups');
    State.groups = groups;
    renderGroupList(groups);
  } finally {
    setLoading('groups', false);
  }
}

function renderGroupList(groups) {
  const wrap = $('groups-list');
  if (!wrap) return;
  const ICONS = { trip:'✈️', home:'🏠', food:'🍱', general:'🎉', other:'📦' };
  const CLASSES = { trip:'trip', home:'home', food:'food', general:'other', other:'other' };
  if (!groups.length) {
    wrap.innerHTML = `<div style="text-align:center;color:var(--muted);padding:28px;font-size:13px">No groups yet. Create one!</div>`;
    return;
  }
  wrap.innerHTML = groups.map(g => `
    <div class="group-card" onclick="openGroup('${g.id}')">
      <div class="gi ${CLASSES[g.category]||'other'}">${ICONS[g.category]||'📦'}</div>
      <div class="group-info">
        <div class="group-name">${esc(g.name)}</div>
        <div class="group-sub">${g.member_count} members</div>
      </div>
      <div class="group-bal" style="color:var(--muted)" id="gbal-${g.id}">…</div>
    </div>`).join('') +
    `<div class="group-card" style="border-style:dashed;justify-content:center;gap:8px" onclick="openCreateGroup()">
       <i class="fa fa-plus" style="color:var(--muted)"></i>
       <span style="color:var(--muted);font-size:14px">Create new group</span>
     </div>`;

  // Lazy-load balances for each group
  if (State.currentUser) {
    groups.forEach(g => {
      GET(`/groups/${g.id}/balances`).then(bals => {
        const my = bals.find(b => b.member_id === State.currentUser.id);
        const el = $('gbal-' + g.id);
        if (el && my) {
          el.textContent = (my.balance >= 0 ? '+' : '') + '₹' + Math.abs(my.balance).toFixed(0);
          el.style.color = my.balance >= 0 ? 'var(--green)' : my.balance < 0 ? 'var(--red)' : 'var(--muted)';
        } else if (el) el.textContent = 'Settled';
      }).catch(() => {});
    });
  }
}

async function openGroup(gid) {
  setLoading('gdetail', true);
  try {
    State.activeGroup = await GET(`/groups/${gid}`);
    goTo('gdetail');
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading('gdetail', false);
  }
}

/* ─────────────────────────────────────────
   GROUP DETAIL
───────────────────────────────────────── */
async function loadGroupDetail(gid) {
  const g = State.activeGroup;
  if (!g) return;

  // Header
  $('gd-name').textContent = (CAT_EMOJI[g.category]||'📦') + ' ' + g.name;
  $('gd-sub').textContent  = `${g.member_count} members`;

  // Member chips
  renderMemberChips(g.members || []);

  // Load expenses, balances, suggestions in parallel
  const [exps, bals, sugs] = await Promise.all([
    GET(`/groups/${gid}/expenses`),
    GET(`/groups/${gid}/balances`),
    GET(`/groups/${gid}/settlements/suggestions`),
  ]);
  State.activeGroupExpenses    = exps;
  State.activeGroupBalances    = bals;
  State.activeGroupSuggestions = sugs;

  renderExpensePane(exps, g.members || []);
  renderBalancePane(bals, g.members || []);
  renderSettlePane(sugs, g.members || []);
}

function renderMemberChips(members) {
  const wrap = $('member-chips');
  if (!wrap) return;
  const COLORS = ['p','g','a','r','b'];
  wrap.innerHTML = members.map((m, i) => {
    const initials = m.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const cls = i === 0 ? COLORS[0] + ' me' : COLORS[i % COLORS.length];
    return `<div class="m-chip">
      <div class="m-av ${cls}">${initials}</div>
      <div class="m-name">${m.name.split(' ')[0]}</div>
    </div>`;
  }).join('') +
  `<div class="m-chip" onclick="toast('Add member via API')">
     <div class="m-av add"><i class="fa fa-plus" style="font-size:16px"></i></div>
     <div class="m-name">Add</div>
   </div>`;
}

function renderExpensePane(exps, members) {
  const wrap = $('pane-exp');
  if (!wrap) return;
  if (!exps.length) {
    wrap.innerHTML = `<div style="text-align:center;color:var(--muted);padding:28px;font-size:13px">No expenses yet.</div>`;
    return;
  }
  const memberMap = {};
  members.forEach(m => memberMap[m.id] = m.name);

  wrap.innerHTML = exps.map(e => {
    const emoji = CAT_EMOJI[e.category] || '💰';
    const payer = memberMap[e.paid_by] || e.payer_name || 'Unknown';
    const daysAgo = Math.floor((Date.now() - new Date(e.date)) / 86400000);
    const when = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;
    const myShare = e.amount / (members.length || 1);
    const iGet = e.paid_by === State.currentUser?.id;
    return `
      <div class="exp-row" onclick="openExpModal('${esc(e.id)}')">
        <div class="exp-icon">${emoji}</div>
        <div class="exp-info">
          <div class="exp-name">${esc(e.description)}</div>
          <div class="exp-meta">${payer} · ${when}</div>
        </div>
        <div class="exp-right">
          <div class="exp-total">₹${Number(e.amount).toLocaleString('en-IN')}</div>
          <div class="exp-share" style="color:${iGet?'var(--green)':'var(--red)'}">
            ${iGet?'+':'−'}₹${myShare.toFixed(0)}
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderBalancePane(bals, members) {
  const wrap = $('pane-bal');
  if (!wrap) return;
  const max = Math.max(...bals.map(b => Math.abs(b.balance)), 1);
  const COLORS = ['p','g','a','r','b'];
  const memberMap = {};
  members.forEach((m, i) => { memberMap[m.id] = { ...m, colorClass: COLORS[i % COLORS.length] }; });

  wrap.innerHTML = bals.map(b => {
    const m = memberMap[b.member_id];
    const initials = m ? m.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase() : '??';
    const cls = m ? m.colorClass : 'p';
    const pct = Math.round(Math.abs(b.balance) / max * 100);
    const col = b.balance > 0 ? 'var(--green)' : b.balance < 0 ? 'var(--red)' : 'var(--muted)';
    const amtStr = (b.balance >= 0 ? '+' : '') + '₹' + Math.abs(b.balance).toFixed(2);
    const isMe = b.member_id === State.currentUser?.id;
    return `
      <div class="bal-item">
        <div class="bal-row">
          <div class="bal-who">
            <div class="m-av ${cls}${isMe?' me':''}" style="width:32px;height:32px;font-size:11px">${initials}</div>
            <div class="bal-name">${b.member_name}${isMe?' (you)':''}</div>
          </div>
          <div class="bal-amt" style="color:${col}">${amtStr}</div>
        </div>
        <div class="prog">
          <div class="prog-fill" style="width:${pct}%;background:${col}"></div>
        </div>
      </div>`;
  }).join('') +
  `<div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px 13px;margin-top:4px;font-size:11px;color:var(--muted)">
     <i class="fa fa-circle-info" style="margin-right:5px"></i>Positive = owed · Negative = owes
   </div>`;
}

function renderSettlePane(suggestions, members) {
  const wrap = $('pane-settle');
  if (!wrap) return;
  const memberMap = {};
  members.forEach(m => memberMap[m.id] = m);
  const COLORS = ['p','g','a','r','b'];

  if (!suggestions.length) {
    wrap.innerHTML = `<div style="text-align:center;color:var(--green);padding:28px;font-size:14px;font-weight:600">✓ All settled up!</div>`;
    return;
  }

  wrap.innerHTML = `<div style="font-size:11px;color:var(--muted);margin-bottom:12px">
    <i class="fa fa-circle-info" style="color:var(--accent);margin-right:5px"></i>
    Simplified — <strong style="color:var(--accent)">${suggestions.length} transaction${suggestions.length>1?'s':''}</strong> clears all debts
  </div>` +
  suggestions.map((s, i) => {
    const from = s.from_name || 'Member';
    const to   = s.to_name   || 'Member';
    const fromInit = from.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const toInit   = to.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const fromCls  = COLORS[(i*2) % COLORS.length];
    const toCls    = COLORS[(i*2+1) % COLORS.length];
    const isMe     = s.from_id === State.currentUser?.id;
    return `
      <div class="settle-card">
        <div class="settle-flow">
          <div class="s-av ${fromCls}">${fromInit}</div>
          <div class="arrow-track">
            <div class="arrow-line"></div>
            <i class="fa fa-arrow-right" style="color:var(--accent);font-size:14px"></i>
          </div>
          <div class="s-av ${toCls}">${toInit}</div>
        </div>
        <div class="settle-info">
          <div>
            <div style="font-size:13px;font-weight:600">${esc(from)} → ${esc(to)}</div>
            <div class="settle-meta">${s.upi_id || 'No UPI ID'}</div>
          </div>
          <div style="text-align:right">
            <div class="settle-amt" style="color:var(--red)">₹${Number(s.amount).toLocaleString('en-IN')}</div>
          </div>
        </div>
        ${s.upi_id && isMe
          ? `<button class="full-btn" onclick="openQR('${esc(to)}','${esc(s.upi_id)}',${s.amount})">
               <i class="fa fa-qrcode"></i> Generate UPI QR
             </button>`
          : isMe
          ? `<button class="full-btn" onclick="toast('Ask ${esc(to)} to share UPI ID')">
               <i class="fa fa-paper-plane"></i> Request UPI ID
             </button>`
          : `<button class="full-btn ghost" onclick="sendReminder('${esc(from)}')">
               <i class="fa fa-paper-plane"></i> Send reminder to ${esc(from)}
             </button>`
        }
      </div>`;
  }).join('');
}

/* ─────────────────────────────────────────
   SETTLE-UP SCREEN (cross-group)
───────────────────────────────────────── */
async function loadSettle() {
  setLoading('settle', true);
  try {
    const groups = State.groups.length ? State.groups : await GET('/groups');
    const debtList = [];
    const actList  = [];

    for (const g of groups) {
      const [sugs, setts] = await Promise.all([
        GET(`/groups/${g.id}/settlements/suggestions`),
        GET(`/groups/${g.id}/settlements`),
      ]);
      sugs.forEach(s => debtList.push({ ...s, groupName: g.name }));
      setts.slice(0,3).forEach(s => actList.push({ ...s, groupName: g.name }));
    }

    renderSettleScreen(debtList, actList);
  } finally {
    setLoading('settle', false);
  }
}

function renderSettleScreen(debts, activity) {
  const dWrap = $('settle-debts');
  const aWrap = $('settle-activity');
  const info  = $('settle-info');

  if (info) info.textContent =
    `Greedy algorithm — ${debts.length} transfer${debts.length!==1?'s':''} settle everything`;

  const myDebts = debts.filter(d => d.from_id === State.currentUser?.id);
  const iAmOwed = debts.filter(d => d.to_id   === State.currentUser?.id);

  if (dWrap) {
    dWrap.innerHTML = !debts.length
      ? `<div style="text-align:center;color:var(--green);padding:28px;font-weight:600;font-size:14px">✓ All settled across all groups!</div>`
      : [...myDebts, ...iAmOwed].map(d => {
          const iOwe = d.from_id === State.currentUser?.id;
          return `
            <div class="debt-card">
              <div class="debt-header">
                <div class="debt-names">
                  <span class="dn-from">${esc(d.from_name)}</span>
                  <span class="debt-arrow">→</span>
                  <span class="dn-to">${esc(d.to_name)}</span>
                </div>
                <div class="debt-amt" style="color:${iOwe?'var(--red)':'var(--green)'}">
                  ₹${Number(d.amount).toLocaleString('en-IN')}
                </div>
              </div>
              <div style="font-size:11px;color:var(--muted);margin-bottom:11px">
                ${d.upi_id||'No UPI'} · ${esc(d.groupName)}
              </div>
              ${iOwe && d.upi_id
                ? `<button class="full-btn" onclick="openQR('${esc(d.to_name)}','${esc(d.upi_id)}',${d.amount})">
                     <i class="fa fa-qrcode"></i> Pay via UPI QR
                   </button>`
                : `<button class="full-btn ghost" onclick="sendReminder('${esc(d.from_name)}')">
                     <i class="fa fa-paper-plane"></i> Send reminder
                   </button>`
              }
            </div>`;
        }).join('');
  }

  if (aWrap) {
    aWrap.innerHTML = activity.slice(0, 6).map(s => `
      <div class="act-item">
        <div class="act-icon" style="background:${s.status==='completed'?'var(--green-dim)':'var(--amber-dim)'};font-size:15px;color:${s.status==='completed'?'var(--green)':'var(--amber)'}">
          <i class="fa ${s.status==='completed'?'fa-check':'fa-clock'}"></i>
        </div>
        <div class="act-info">
          <div class="act-name">${esc(s.from_name)} → ${esc(s.to_name)}</div>
          <div class="act-meta">${esc(s.groupName)} · ₹${Number(s.amount).toFixed(2)}</div>
        </div>
        <div class="act-amounts">
          <span class="badge ${s.status==='completed'?'badge-green':'badge-amber'}">
            ${s.status==='completed'?'Paid':'Pending'}
          </span>
        </div>
      </div>`).join('') ||
      `<div style="text-align:center;color:var(--muted);padding:16px;font-size:12px">No settlements yet.</div>`;
  }
}

/* ─────────────────────────────────────────
   ANALYTICS
───────────────────────────────────────── */
async function loadAnalytics(gid) {
  setLoading('analytics', true);
  try {
    const data = await GET(`/groups/${gid}/analytics`);
    State.activeGroupAnalytics = data;
    renderAnalytics(data);
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading('analytics', false);
  }
}

function renderAnalytics(data) {
  const fmt = v => v >= 1000 ? '₹' + (v/1000).toFixed(1) + 'k' : '₹' + v.toFixed(0);

  if ($('an-total'))   $('an-total').textContent   = fmt(data.total_expenses || 0);
  if ($('an-count'))   $('an-count').textContent   = data.expense_count || 0;
  if ($('an-perperson')) {
    const pp = data.member_count ? data.total_expenses / data.member_count : 0;
    $('an-perperson').textContent = fmt(pp);
  }
  // Top spender
  const byMem = data.by_member || {};
  const topSpender = Object.entries(byMem).sort((a,b)=>b[1]-a[1])[0];
  if ($('an-top') && topSpender) $('an-top').textContent = topSpender[0];

  // Draw bars
  drawAnalyticsBars(byMem);
}

function drawAnalyticsBars(byMem) {
  const wrap = $('bar-chart-analytics');
  if (!wrap) return;
  const entries = Object.entries(byMem).sort((a,b)=>b[1]-a[1]);
  if (!entries.length) { wrap.innerHTML=''; return; }
  const max = entries[0][1];
  const COLORS = ['#6C63FF','#22C55E','#F59E0B','#FF5C5C','#60A5FA'];
  wrap.innerHTML = entries.map(([name, val], i) => `
    <div class="bar-row">
      <div class="bar-name">${name.split(' ')[0]}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.round(val/max*100)}%;background:${COLORS[i%COLORS.length]}"></div>
      </div>
      <div class="bar-val">₹${val >= 1000 ? (val/1000).toFixed(1)+'k' : val.toFixed(0)}</div>
    </div>`).join('');
}

/* ─────────────────────────────────────────
   PROFILE
───────────────────────────────────────── */
async function loadProfile() {
  if (!State.currentUser) return;
  const m = State.currentUser;
  const initials = m.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  if ($('profile-av'))   $('profile-av').textContent   = initials;
  if ($('profile-name')) $('profile-name').textContent = m.name;
  if ($('profile-email'))$('profile-email').textContent= m.email;
  if ($('profile-upi'))  $('profile-upi').textContent  = m.upi_id || 'No UPI ID set';
}

/* ─────────────────────────────────────────
   EXPENSE MODAL (view / edit / delete)
───────────────────────────────────────── */
async function openExpModal(expId) {
  try {
    const e = await GET(`/expenses/${expId}`);
    $('ed-title').textContent  = e.description;
    $('ed-amount').textContent = '₹' + Number(e.amount).toLocaleString('en-IN');
    $('ed-cat').textContent    = (CAT_EMOJI[e.category]||'📦') + ' ' + (e.category||'General');
    $('ed-paidby').textContent = e.payer_name || 'Unknown';
    $('ed-split').textContent  = e.split_type || 'equal';
    $('ed-meta').textContent   = new Date(e.date).toLocaleDateString('en-IN', { dateStyle:'medium' });
    const share = (e.amount / 4).toFixed(2);
    $('ed-share').textContent  = '₹' + share;

    // Wire delete button
    $('ed-delete-btn').onclick = async () => {
      try {
        await DELETE(`/expenses/${expId}`);
        toast('Expense deleted', 'success');
        closeModal('modal-exp');
        // Refresh current screen
        if (State.activeGroup) loadGroupDetail(State.activeGroup.id);
      } catch (err) { showError(err.message); }
    };
    openModal('modal-exp');
  } catch (err) {
    showError(err.message);
  }
}

/* ─────────────────────────────────────────
   ADD EXPENSE FORM
───────────────────────────────────────── */
function openAddExpense() {
  $('inp-date').value = new Date().toISOString().split('T')[0];
  // Populate group dropdown
  const sel = $('inp-group');
  if (sel && State.groups.length) {
    sel.innerHTML = State.groups.map(g =>
      `<option value="${g.id}">${esc(g.name)}</option>`).join('');
    if (State.activeGroup) sel.value = State.activeGroup.id;
  }
  // Populate payer dropdown
  const members = State.activeGroup ? (State.activeGroup.members || []) : [];
  const pSel = $('inp-payer');
  if (pSel && members.length) {
    pSel.innerHTML = members.map(m =>
      `<option value="${m.id}"${m.id===State.currentUser?.id?' selected':''}>${esc(m.name)}${m.id===State.currentUser?.id?' (you)':''}</option>`
    ).join('');
  }
  openModal('modal-add');
}

async function submitExpense() {
  const desc   = $('inp-desc').value.trim();
  const amount = parseFloat($('inp-amount').value);
  const payer  = $('inp-payer')?.value;
  const gid    = $('inp-group')?.value;

  if (!desc)       { toast('Enter a description', 'error'); return; }
  if (!amount || amount <= 0) { toast('Enter a valid amount', 'error'); return; }
  if (!gid)        { toast('Select a group', 'error'); return; }

  const btn = $('submit-exp-btn');
  btn.disabled = true;
  btn.textContent = 'Adding…';

  try {
    const body = {
      description: desc,
      amount,
      paid_by:    payer,
      split_type: State.addExpForm.split,
      category:   State.addExpForm.cat,
      date:       $('inp-date').value,
      split_data: { participants: [] },
    };
    await POST(`/groups/${gid}/expenses`, body);
    toast('Expense added ✓', 'success');
    closeModal('modal-add');
    $('inp-desc').value   = '';
    $('inp-amount').value = '';
    if (State.activeGroup?.id === gid) loadGroupDetail(gid);
    else loadGroups();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Expense';
  }
}

function setCat(btn) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  State.addExpForm.cat = btn.dataset.cat;
}
function setSplit(btn) {
  document.querySelectorAll('.chip').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  State.addExpForm.split = btn.dataset.val;
}

/* ─────────────────────────────────────────
   CREATE GROUP FORM
───────────────────────────────────────── */
async function submitGroup() {
  const name = $('cg-name').value.trim();
  const cat  = $('cg-cat').value;
  const desc = $('cg-desc').value.trim();
  if (!name) { toast('Enter a group name', 'error'); return; }

  const btn = $('cg-submit-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const g = await POST('/groups', {
      name, description: desc, category: cat,
      created_by: State.currentUser?.id,
      member_ids: State.currentUser ? [State.currentUser.id] : [],
    });
    toast('Group created ✓', 'success');
    closeModal('modal-creategroup');
    $('cg-name').value = '';
    $('cg-desc').value = '';
    await loadGroups();
    await openGroup(g.id);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Create Group';
  }
}
function openCreateGroup() { openModal('modal-creategroup'); }

/* ─────────────────────────────────────────
   UPI QR MODAL
───────────────────────────────────────── */
let _qrObj = null;
let _activeSettlementId = null;

function openQR(name, upiId, amount) {
  $('qr-title').textContent   = amount > 0 ? 'Pay ' + name : 'My UPI QR';
  $('qr-upi-lbl').textContent = upiId;
  $('qr-amt-lbl').textContent = amount > 0 ? '₹' + Number(amount).toLocaleString('en-IN') : 'Receive payment';

  const box = $('qr-render');
  box.innerHTML = '';

  const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(name)}&am=${amount}&cu=INR&tn=BillSplitter`;

  try {
    _qrObj = new QRCode(box, { text: upiUrl, width: 155, height: 155, colorDark: '#000', colorLight: '#fff' });
  } catch {
    box.innerHTML = `<div style="padding:8px;font-size:10px;color:#333;text-align:center">UPI:<br>${upiId}</div>`;
  }
  openModal('modal-qr');
}

async function markPaid() {
  if (_activeSettlementId) {
    try {
      await POST(`/settlements/${_activeSettlementId}/complete`, {});
      toast('Settlement recorded ✓', 'success');
    } catch {}
  } else {
    toast('Payment marked as paid ✓', 'success');
  }
  closeModal('modal-qr');
  if (_qrObj) { try { _qrObj.clear(); } catch {} _qrObj = null; }
}

/* ─────────────────────────────────────────
   AUTH (LOGIN / REGISTER)
   loginDemo is defined later in the file — see OVERRIDE loginDemo section
───────────────────────────────────────── */

async function submitLogin() {
  const email = $('login-email').value.trim();
  if (!email) { toast('Enter your email', 'error'); return; }

  const btn = $('login-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    // Try to reach backend
    let members;
    try {
      members = await GET('/members');
    } catch(netErr) {
      // Backend unreachable — fall back to demo
      toast('Backend offline — loading demo mode', 'default');
      await loginDemo();
      return;
    }

    const found = members.find(m => m.email.toLowerCase() === email.toLowerCase());
    if (!found) {
      // Show helpful message with exact issue
      showError('No account found for ' + email + '. Please Register first, or use Try Demo.');
      return;
    }
    State.currentUser = found;
    // Persist session in localStorage so page refresh keeps you logged in
    try { localStorage.setItem('bs_user', JSON.stringify(found)); } catch(e) {}
    toast('Welcome back, ' + found.name + '!', 'success');
    goTo('home');
    loadHome();
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

async function submitRegister() {
  const name  = $('reg-name').value.trim();
  const email = $('reg-email').value.trim();
  const upi   = $('reg-upi').value.trim();
  if (!name) { toast('Enter your name', 'error'); return; }
  if (!email) { toast('Enter your email', 'error'); return; }

  const btn = $('reg-btn');
  btn.disabled = true; btn.textContent = 'Creating…';

  // Show which API URL we are hitting
  console.log('Registering at:', window.BS_API_BASE);

  try {
    const m = await POST('/members', { name, email, upi_id: upi || null });
    State.currentUser = m;
    try { localStorage.setItem('bs_user', JSON.stringify(m)); } catch(e) {}
    toast('Account created! Welcome, ' + m.name + ' 🎉', 'success');
    goTo('home');
    loadHome();
  } catch (err) {
    console.error('Register error:', err);
    // Show full error on screen so user can see it
    showError('Register failed: ' + err.message + ' (API: ' + window.BS_API_BASE + ')');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Account';
  }
}

/* ─────────────────────────────────────────
   GENERIC MODAL HELPERS
───────────────────────────────────────── */
function openModal(id)  { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

// Close modal when clicking backdrop
document.addEventListener('click', e => {
  ['modal-add','modal-qr','modal-exp','modal-creategroup'].forEach(id => {
    if (e.target.id === id) closeModal(id);
  });
});

// Android back button
window.addEventListener('popstate', () => {
  ['modal-add','modal-qr','modal-exp','modal-creategroup'].forEach(closeModal);
});

/* ─────────────────────────────────────────
   MISC HELPERS
───────────────────────────────────────── */
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function switchTab(tab) {
  ['exp','bal','settle'].forEach(id => {
    $('tb-' + id).classList.toggle('active', id === tab);
    $('pane-' + id).style.display = id === tab ? 'block' : 'none';
  });
}

function sendReminder(name) {
  toast('Reminder sent to ' + name + ' 📩');
}

/* ─────────────────────────────────────────
   INIT
───────────────────────────────────────── */
(function init() {
  updateClock();

  // Restore session from localStorage (survives page refresh)
  try {
    const saved = localStorage.getItem('bs_user');
    if (saved) {
      const user = JSON.parse(saved);
      // Verify user still exists in backend
      GET('/members/' + user.id).then(m => {
        State.currentUser = m;
        const initials = m.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        $('home-avatar')   && ($('home-avatar').textContent   = initials);
        $('home-greeting') && ($('home-greeting').textContent = 'Hi, ' + m.name.split(' ')[0] + ' 👋');
        toast('Welcome back, ' + m.name + '!', 'success');
        goTo('home');
        loadHome();
      }).catch(() => {
        // User no longer in DB (DB was reset) — show login
        localStorage.removeItem('bs_user');
        goTo('login');
      });
      return; // wait for async check above
    }
  } catch(e) {}

  // No saved session — show login screen
  goTo('login');
})();

// Expose ALL functions to HTML onclick handlers
Object.assign(window, {
  goTo, toast,
  openAddExpense, submitExpense, setCat, setSplit,
  openGroup, openCreateGroup, submitGroup,
  openExpModal, openQR, markPaid, sendReminder,
  switchTab, submitLogin, submitRegister, closeModal,
});
// These are defined after this block and exported individually below

/* ─────────────────────────────────────────
   AUTH TAB SWITCH
───────────────────────────────────────── */
function authTab(tab) {
  document.getElementById('at-login').classList.toggle('active', tab === 'login');
  document.getElementById('at-register').classList.toggle('active', tab === 'register');
  document.getElementById('auth-login').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('auth-register').style.display = tab === 'register' ? 'block' : 'none';
}

/* ─────────────────────────────────────────
   SIGN OUT
───────────────────────────────────────── */
function doSignOut() {
  State.currentUser = null;
  State.groups = [];
  State.activeGroup = null;
  try { localStorage.removeItem('bs_user'); } catch(e) {}
  toast('Signed out');
  goTo('login');
}

/* ─────────────────────────────────────────
   MY UPI QR (profile screen)
───────────────────────────────────────── */
function openMyQR() {
  const m = State.currentUser;
  if (!m) { toast('Sign in first', 'error'); return; }
  if (!m.upi_id) { toast('No UPI ID set on your profile', 'error'); return; }
  openQR(m.name, m.upi_id, 0);
}

/* ─────────────────────────────────────────
   PROFILE STATS
───────────────────────────────────────── */
async function loadProfile() {
  const m = State.currentUser;
  if (!m) return;
  const initials = m.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  $('profile-av')    && ($('profile-av').textContent    = initials);
  $('profile-name')  && ($('profile-name').textContent  = m.name);
  $('profile-email') && ($('profile-email').textContent = m.email);
  $('profile-upi')   && ($('profile-upi').textContent   = m.upi_id || 'No UPI ID set');
  $('home-avatar')   && ($('home-avatar').textContent   = initials);
  $('home-greeting') && ($('home-greeting').textContent = 'Hi, ' + m.name.split(' ')[0] + ' 👋');

  // Aggregate total spend
  try {
    const groups = State.groups.length ? State.groups : await GET('/groups');
    $('profile-groups') && ($('profile-groups').textContent = groups.length);
    let total = 0;
    for (const g of groups) {
      const an = await GET(`/groups/${g.id}/analytics`).catch(() => null);
      if (an) {
        const myContrib = (an.by_member || {})[m.name] || 0;
        total += myContrib;
      }
    }
    $('profile-total') && ($('profile-total').textContent =
      total >= 1000 ? '₹' + (total / 1000).toFixed(1) + 'k' : '₹' + total.toFixed(0));
  } catch {}
}

/* ─────────────────────────────────────────
   DONUT CHART (analytics)
───────────────────────────────────────── */
const CHART_COLORS = ['#6C63FF','#22C55E','#F59E0B','#FF5C5C','#60A5FA','#A78BFA'];

function drawDonut(byCat, total) {
  const svg    = $('donut-svg');
  const legend = $('donut-legend');
  const center = $('donut-center-val');
  if (!svg || !legend) return;

  const R = 46, CX = 60, CY = 60, SW = 18;
  const CIRC = 2 * Math.PI * R;

  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return;

  // Remove old arcs (keep background circle)
  svg.querySelectorAll('.arc').forEach(el => el.remove());

  let offset = 0;
  entries.forEach(([cat, val], i) => {
    const pct  = val / total;
    const dash = pct * CIRC;
    const gap  = CIRC - dash;
    const color = CHART_COLORS[i % CHART_COLORS.length];

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', CX); circle.setAttribute('cy', CY); circle.setAttribute('r', R);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', SW);
    circle.setAttribute('stroke-dasharray', `${dash.toFixed(2)} ${gap.toFixed(2)}`);
    circle.setAttribute('stroke-dashoffset', (-offset).toFixed(2));
    circle.classList.add('arc');
    svg.appendChild(circle);
    offset += dash;
  });

  const fmt = v => v >= 1000 ? '₹' + (v / 1000).toFixed(1) + 'k' : '₹' + v.toFixed(0);
  if (center) center.textContent = fmt(total);

  legend.innerHTML = entries.slice(0, 5).map(([cat, val], i) => `
    <div class="legend-row">
      <div class="ldot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></div>
      <span>${cat.charAt(0).toUpperCase() + cat.slice(1)}</span>
      <span class="lpct">${Math.round(val / total * 100)}%</span>
    </div>`).join('');
}

/* ─────────────────────────────────────────
   SPARKLINE (analytics daily spending)
───────────────────────────────────────── */
function drawSparkline(expenses) {
  const line = $('spark-line');
  const fill = $('spark-fill');
  if (!line || !fill || !expenses.length) return;

  // Bucket by day (last 7 days)
  const buckets = new Array(7).fill(0);
  const now = Date.now();
  expenses.forEach(e => {
    const daysAgo = Math.floor((now - new Date(e.date)) / 86400000);
    if (daysAgo >= 0 && daysAgo < 7) buckets[6 - daysAgo] += Number(e.amount);
  });

  const W = 340, H = 80, PAD = 10;
  const maxV = Math.max(...buckets, 1);
  const pts = buckets.map((v, i) => {
    const x = PAD + (i / (buckets.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v / maxV) * (H - PAD * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const d = 'M ' + pts.join(' L ');
  line.setAttribute('d', d);
  fill.setAttribute('d', d + ` L ${(W - PAD).toFixed(1)},${H} L ${PAD},${H} Z`);
}

/* Updated loadAnalytics to use real donut + sparkline */
async function loadAnalytics(gid) {
  if ($('an-group-name') && State.activeGroup)
    $('an-group-name').textContent = State.activeGroup.name;

  setLoading('analytics', true);
  try {
    const [data, exps] = await Promise.all([
      GET(`/groups/${gid}/analytics`),
      GET(`/groups/${gid}/expenses`),
    ]);
    State.activeGroupAnalytics = data;

    const fmt = v => v >= 1000 ? '₹' + (v / 1000).toFixed(1) + 'k' : '₹' + v.toFixed(0);
    $('an-total')     && ($('an-total').textContent     = fmt(data.total_expenses || 0));
    $('an-count')     && ($('an-count').textContent     = data.expense_count || 0);
    const pp = data.member_count ? (data.total_expenses || 0) / data.member_count : 0;
    $('an-perperson') && ($('an-perperson').textContent = fmt(pp));

    const byMem = data.by_member || {};
    const top   = Object.entries(byMem).sort((a, b) => b[1] - a[1])[0];
    $('an-top') && ($('an-top').textContent = top ? top[0].split(' ')[0] : '—');

    drawDonut(data.by_category || {}, data.total_expenses || 0);
    drawAnalyticsBars(byMem);
    drawSparkline(exps);
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading('analytics', false);
  }
}

/* ─────────────────────────────────────────
   DEMO DATA (offline / no-backend mode)
───────────────────────────────────────── */
function loadDemoData() {
  State.groups = [
    { id:'g1', name:'Goa Trip 2025',  category:'trip',  member_count:4 },
    { id:'g2', name:'Flat 4B',        category:'home',  member_count:3 },
    { id:'g3', name:'Office Lunches', category:'food',  member_count:8 },
    { id:'g4', name:'Weekend Squad',  category:'other', member_count:6 },
  ];

  const demoMembers = [
    { id:'m1', name:'Alex Kumar', colorClass:'p' },
    { id:'m2', name:'Sarah',      colorClass:'g' },
    { id:'m3', name:'Mike',       colorClass:'a' },
    { id:'m4', name:'Raj',        colorClass:'r' },
  ];

  $('home-net-balance').textContent = '+₹354.50';
  $('home-net-balance').style.color = 'var(--green)';
  $('home-owed').textContent  = '₹482.50';
  $('home-owes').textContent  = '₹128.00';
  $('home-bal-sub').textContent = "You're owed by 4 friends";

  const DEMO_EXPENSES = [
    { id:'e1', description:'Artisan pizza night', amount:840,  category:'food',          payer_name:'Alex',  date: new Date(Date.now()-86400000).toISOString(),   paid_by:'m1', groupName:'Goa Trip' },
    { id:'e2', description:'Monthly utilities',   amount:210,  category:'home',          payer_name:'Sarah', date: new Date(Date.now()-172800000).toISOString(),  paid_by:'m2', groupName:'Flat 4B' },
    { id:'e3', description:'Cab to airport',       amount:380,  category:'transport',     payer_name:'Mike',  date: new Date(Date.now()-259200000).toISOString(),  paid_by:'m3', groupName:'Goa Trip' },
    { id:'e4', description:'Movie tickets',        amount:1200, category:'entertainment', payer_name:'Alex',  date: new Date(Date.now()-345600000).toISOString(),  paid_by:'m1', groupName:'Weekend Squad' },
    { id:'e5', description:'Hotel deposit',        amount:4800, category:'accommodation', payer_name:'Alex',  date: new Date(Date.now()-432000000).toISOString(),  paid_by:'m1', groupName:'Goa Trip' },
    { id:'e6', description:'Sunset bar tab',       amount:1200, category:'food',          payer_name:'Raj',   date: new Date(Date.now()-518400000).toISOString(),  paid_by:'m4', groupName:'Goa Trip' },
  ];

  renderRecentActivity(DEMO_EXPENSES);

  // Groups screen
  renderGroupList(State.groups.map((g, i) => ({
    ...g,
    _demoBalance: [3678, -105, 420, 0][i],
  })));

  // Override balance display for demo
  State.groups.forEach((g, i) => {
    const el = $('gbal-' + g.id);
    if (!el) return;
    const bals = [3678, -105, 420, 0];
    const b = bals[i];
    el.textContent = b === 0 ? 'Settled' : (b > 0 ? '+' : '') + '₹' + Math.abs(b);
    el.style.color = b > 0 ? 'var(--green)' : b < 0 ? 'var(--red)' : 'var(--muted)';
  });

  // Group detail demo
  State.activeGroup = {
    id: 'g1', name: 'Goa Trip 2025', category: 'trip',
    member_count: 4, members: demoMembers
  };

  State.activeGroupExpenses    = DEMO_EXPENSES;
  State.activeGroupBalances    = [
    { member_id:'m1', member_name:'Alex',  balance:3678 },
    { member_id:'m3', member_name:'Mike',  balance:170  },
    { member_id:'m2', member_name:'Sarah', balance:-2523 },
    { member_id:'m4', member_name:'Raj',   balance:-1325 },
  ];
  State.activeGroupSuggestions = [
    { from_id:'m2', from_name:'Sarah', to_id:'m1', to_name:'Alex', amount:2353, upi_id:'alex@upi' },
    { from_id:'m4', from_name:'Raj',   to_id:'m1', to_name:'Alex', amount:1325, upi_id:'alex@upi' },
  ];

  renderExpensePane(DEMO_EXPENSES, demoMembers);
  renderBalancePane(State.activeGroupBalances, demoMembers);
  renderSettlePane(State.activeGroupSuggestions, demoMembers);

  // Settle screen demo
  $('settle-info').innerHTML =
    '<i class="fa fa-circle-info" style="color:var(--accent);margin-right:5px"></i>' +
    'Greedy algorithm — <strong style="color:var(--accent)">2 transfers</strong> settle everything';

  renderSettleScreen(
    State.activeGroupSuggestions.map(s => ({ ...s, groupName:'Goa Trip 2025' })),
    [
      { from_name:'Raj', to_name:'Alex', amount:1325, status:'completed', groupName:'Goa Trip' },
      { from_name:'Priya', to_name:'Alex', amount:560, status:'pending',  groupName:'Office Lunches' },
    ]
  );

  // Analytics demo
  $('an-group-name') && ($('an-group-name').textContent = 'Goa Trip 2025');
  $('an-total')      && ($('an-total').textContent      = '₹8,430');
  $('an-count')      && ($('an-count').textContent      = '12');
  $('an-perperson')  && ($('an-perperson').textContent  = '₹2,108');
  $('an-top')        && ($('an-top').textContent        = 'Alex');

  const demoByCat = { food:3200, accommodation:2870, transport:1430, entertainment:930 };
  const demoByMem = { Alex:5480, Sarah:2100, Raj:1200, Mike:680 };
  drawDonut(demoByCat, 8430);
  drawAnalyticsBars(demoByMem);
  drawSparkline(DEMO_EXPENSES);
}

/* ─────────────────────────────────────────
   OVERRIDE loginDemo to use demo data
───────────────────────────────────────── */
async function loginDemo() {
  State.currentUser = { id:'m1', name:'Alex Kumar', email:'alex@demo.com', upi_id:'alex@upi' };

  // Update UI immediately
  $('home-greeting') && ($('home-greeting').textContent = 'Hi, Alex 👋');
  $('home-avatar')   && ($('home-avatar').textContent   = 'AL');
  $('profile-av')    && ($('profile-av').textContent    = 'AL');
  $('profile-name')  && ($('profile-name').textContent  = 'Alex Kumar');
  $('profile-email') && ($('profile-email').textContent = 'alex@demo.com');
  $('profile-upi')   && ($('profile-upi').textContent   = 'alex@upi');
  $('profile-total') && ($('profile-total').textContent = '₹12.4k');
  $('profile-groups')&& ($('profile-groups').textContent= '4');

  toast('Demo mode — no backend needed', 'success');
  goTo('home');
  loadDemoData();
}

/* ─────────────────────────────────────────
   FINAL EXPORTS — all functions available to HTML onclick=""
───────────────────────────────────────── */
Object.assign(window, {
  authTab, doSignOut, openMyQR, loginDemo,
  goTo, toast,
  openAddExpense, submitExpense, setCat, setSplit,
  openGroup, openCreateGroup, submitGroup,
  openExpModal, openQR, markPaid, sendReminder,
  switchTab, submitLogin, submitRegister, closeModal,
});
