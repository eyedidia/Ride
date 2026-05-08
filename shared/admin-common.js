// ═══════════════════════════════════════════════════
// admin-common.js — shared utilities for all admin pages
// ═══════════════════════════════════════════════════

const API_URL = "https://script.google.com/macros/s/AKfycbxST_n3NGcPU99_PmDHLJO3W1Sb12rel6Sf_Y-ihzBFIGmmsYMOfrrxRZMLf-CMETcp/exec";

// Sections each role may access (dashboard always included)
const ADMIN_ROLES = {
  'מנהל':          ['dashboard','riders','events','assignments','bikes','maintenance','exams','settings'],
  'מנהל_רוכבים':  ['dashboard','riders','exams'],
  'מנהל_אירועים': ['dashboard','events','assignments'],
  'מנהל_שיבוצים': ['dashboard','assignments'],
  'מנהל_אופניים': ['dashboard','bikes','maintenance'],
  'מנהל_בדיקות':  ['dashboard','exams'],
  'מנהל_צי':      ['dashboard','bikes','maintenance'],
};

// Returns true if an event date+time is in the past
function eventIsPast(dateStr, timeStr) {
  const [d,m,y] = (dateStr||'').split('/');
  if (!d||!m||!y) return false;
  const time = timeStr ? timeStr.trim() : '23:59';
  return new Date(`${y}-${m}-${d}T${time}:00`) <= new Date();
}

// ─── AUTH GUARD ───────────────────────────────────────
// Call at top of each admin page.
// Returns the user object if authorised, otherwise redirects.
// allowedSections: optional array — if provided, user must have access to at least one.
function checkAdminAccess(allowedSections) {
  const stored = sessionStorage.getItem('user');
  if (!stored) { window.location.replace('index.html'); return null; }
  const u = JSON.parse(stored);
  const perm = u.permission || '';
  const roles = perm.split(',').map(r => r.trim()).filter(Boolean);
  const hasValidRole = roles.some(r => ADMIN_ROLES[r]);
  if (!hasValidRole) { window.location.replace('rider.html'); return null; }
  if (allowedSections) {
    const allowed = getUserAllowedSections(u);
    if (!allowedSections.some(s => allowed.includes(s))) {
      window.location.replace('admin.html'); return null;
    }
  }
  return u;
}

// Returns the set of sections the current user can access (union of all roles).
function getUserAllowedSections(u) {
  const perm = u?.permission || '';
  const roles = perm.split(',').map(r => r.trim()).filter(Boolean);
  const sections = new Set();
  roles.forEach(role => { (ADMIN_ROLES[role] || []).forEach(s => sections.add(s)); });
  return [...sections];
}

// ─── API ──────────────────────────────────────────────
async function apiGet(action, params = {}, _retry = true) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 20000);
  try {
    const qs  = new URLSearchParams({ action, ...params }).toString();
    const res = await fetch(`${API_URL}?${qs}`, { signal: controller.signal });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'שגיאת שרת לא ידועה');
    return data.data;
  } catch(err) {
    if (err.name === 'AbortError') {
      if (_retry) return apiGet(action, params, false);
      throw new Error('הקישור לשרת עלה על הזמן המוקצב. נסה שוב.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callAPI(action, body = {}, _retry = true) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 20000);
  try {
    const qs  = new URLSearchParams({ action, data: JSON.stringify(body) }).toString();
    const res = await fetch(`${API_URL}?${qs}`, { signal: controller.signal });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'שגיאת שרת לא ידועה');
    return data.data;
  } catch(err) {
    if (err.name === 'AbortError') {
      if (_retry) return callAPI(action, body, false);
      throw new Error('הקישור לשרת עלה על הזמן המוקצב. נסה שוב.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

const _regCache = {};
async function getRegistrationsCached(eventId, bustCache) {
  const now = Date.now();
  if (!bustCache && _regCache[eventId] && (now - _regCache[eventId].ts) < 60000) {
    return _regCache[eventId].data;
  }
  const regs = await apiGet('getRegistrations', { eventId });
  _regCache[eventId] = { data: regs, ts: now };
  return regs;
}

// ─── UI UTILITIES ─────────────────────────────────────
function showToast(message, type = 'success') {
  const area  = document.getElementById('toastArea');
  if (!area) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `<span aria-hidden="true">${type === 'success' ? '✅' : '❌'}</span> ${message}`;
  area.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function showLoading(on) {
  let el = document.getElementById('loadingBar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loadingBar';
    el.setAttribute('role', 'progressbar');
    el.setAttribute('aria-label', 'טוען נתונים');
    el.setAttribute('aria-valuetext', 'טוען...');
    el.style.cssText = `position:fixed;top:0;right:0;left:0;height:3px;background:var(--accent);
      z-index:9999;transition:opacity 0.3s;transform-origin:right;`;
    document.body.prepend(el);
  }
  el.style.opacity = on ? '1' : '0';
}

function lockBtn(btnEl, loadingText = '...') {
  if (!btnEl) return;
  btnEl.disabled = true;
  btnEl._origText = btnEl.innerHTML;
  btnEl.innerHTML = `<span style="opacity:.7">${loadingText}</span>`;
  btnEl.setAttribute('aria-busy', 'true');
}

function unlockBtn(btnEl) {
  if (!btnEl) return;
  btnEl.disabled = false;
  btnEl.innerHTML = btnEl._origText || btnEl.innerHTML;
  btnEl.removeAttribute('aria-busy');
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── MODAL ────────────────────────────────────────────
let _lastFocus = null;

function openModal(id, populateFn) {
  if (populateFn) populateFn();
  _lastFocus = document.activeElement;
  const m = document.getElementById(id);
  m.classList.add('open');
  const firstInput = m.querySelector('input, select, button');
  if (firstInput) firstInput.focus();
  document.addEventListener('keydown', _trapFocus);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.removeEventListener('keydown', _trapFocus);
  if (_lastFocus) _lastFocus.focus();
}

function backdropClose(e, id) {
  if (e.target === e.currentTarget) closeModal(id);
}

function _trapFocus(e) {
  if (e.key !== 'Tab') {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
      document.removeEventListener('keydown', _trapFocus);
    }
    return;
  }
  const modal = document.querySelector('.modal-backdrop.open .modal');
  if (!modal) return;
  const focusable = modal.querySelectorAll('input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
  else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
}

// ─── SIDEBAR (tab navigation) ─────────────────────────
function switchTab(btn, panelId) {
  const panel = btn.closest('.panel');
  panel.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected','false');
  });
  panel.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('aria-selected','true');
  document.getElementById(panelId).classList.add('active');
}

// ─── USER CARD ────────────────────────────────────────
// Fills the sidebar user card from sessionStorage user.
function populateUserCard(u) {
  const nameEl   = document.querySelector('.user-name');
  const roleEl   = document.querySelector('.user-role');
  const avatarEl = document.querySelector('.user-avatar');
  const userCard = document.querySelector('.user-card');
  if (!u) return;
  const perm = u.permission || '';
  const roles = perm.split(',').map(r => r.trim()).filter(Boolean);
  const roleLabel = roles.length > 1
    ? roles.map(r => r === 'מנהל' ? 'מנהל מערכת' : r.replace('מנהל_','מנהל ')).join(' + ')
    : (ADMIN_ROLES[perm] ? (perm === 'מנהל' ? 'מנהל מערכת' : perm.replace('מנהל_','מנהל ')) : perm);
  if (nameEl)   nameEl.textContent   = u.name;
  if (roleEl)   roleEl.textContent   = roleLabel;
  if (avatarEl) avatarEl.textContent = u.name.trim().split(' ').map(w=>w[0]).slice(0,2).join('');
  if (userCard) userCard.setAttribute('aria-label', `משתמש מחובר: ${u.name}, ${roleLabel}`);
}
