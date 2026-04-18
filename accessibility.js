/**
 * accessibility.js — שיפורי נגישות מלאים
 * תומך ב-VoiceOver (iOS), TalkBack (Android), ו-NVDA/JAWS
 * יש לכלול קובץ זה בכל שלושת הדפים: login.html, rider.html, admin.html
 *
 * <script src="accessibility.js" defer></script>
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// 1. LIVE REGION ANNOUNCER — הכרזה על שינויים דינמיים
// ═══════════════════════════════════════════════════════════════
const A11y = (() => {
  let politeRegion, assertiveRegion;

  function init() {
    // אזור הכרזה מנומס (לעדכונים רגילים)
    politeRegion = document.createElement('div');
    politeRegion.setAttribute('aria-live', 'polite');
    politeRegion.setAttribute('aria-atomic', 'true');
    politeRegion.setAttribute('aria-relevant', 'additions text');
    politeRegion.className = 'sr-only a11y-polite-region';
    politeRegion.id = 'a11y-polite';

    // אזור הכרזה דחוף (לשגיאות והתראות קריטיות)
    assertiveRegion = document.createElement('div');
    assertiveRegion.setAttribute('aria-live', 'assertive');
    assertiveRegion.setAttribute('aria-atomic', 'true');
    assertiveRegion.className = 'sr-only a11y-assertive-region';
    assertiveRegion.id = 'a11y-assertive';

    // סגנון מסתיר ויזואלית אך גלוי לקוראי מסך
    const style = document.createElement('style');
    style.textContent = `
      .sr-only {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0,0,0,0) !important;
        white-space: nowrap !important;
        border: 0 !important;
      }

      /* פוקוס גלוי מאוד — חשוב לניווט מקלדת */
      :focus-visible {
        outline: 3px solid #4f7cff !important;
        outline-offset: 3px !important;
        border-radius: 6px !important;
        box-shadow: 0 0 0 6px rgba(79,124,255,0.25) !important;
      }

      /* ודא כל האלמנטים האינטראקטיביים פוקוסביליים */
      button:focus-visible,
      a:focus-visible,
      input:focus-visible,
      select:focus-visible,
      textarea:focus-visible,
      [tabindex]:focus-visible {
        outline: 3px solid #4f7cff !important;
        outline-offset: 3px !important;
      }

      /* Skip link — ניווט מהיר לתוכן ראשי */
      .skip-link {
        position: absolute;
        top: -100%;
        right: 0;
        background: #4f7cff;
        color: #fff;
        padding: 12px 20px;
        font-size: 1rem;
        font-weight: 700;
        text-decoration: none;
        border-radius: 0 0 8px 8px;
        z-index: 9999;
        transition: top 0.2s;
      }
      .skip-link:focus {
        top: 0 !important;
        outline: 3px solid #fff !important;
      }
    `;

    document.head.appendChild(style);
    document.body.insertAdjacentElement('afterbegin', assertiveRegion);
    document.body.insertAdjacentElement('afterbegin', politeRegion);
  }

  // הכרזה מנומסת (לא מפריעה לדיבור נוכחי)
  function announce(msg) {
    if (!politeRegion) return;
    politeRegion.textContent = '';
    requestAnimationFrame(() => { politeRegion.textContent = msg; });
  }

  // הכרזה דחופה (מפסיקה דיבור נוכחי — לשגיאות בלבד)
  function announceUrgent(msg) {
    if (!assertiveRegion) return;
    assertiveRegion.textContent = '';
    requestAnimationFrame(() => { assertiveRegion.textContent = msg; });
  }

  return { init, announce, announceUrgent };
})();

// ═══════════════════════════════════════════════════════════════
// 2. SKIP LINK — קפיצה לתוכן הראשי
// ═══════════════════════════════════════════════════════════════
function ensureSkipLink() {
  if (document.querySelector('.skip-link')) return; // כבר קיים
  const mainId = document.querySelector('main')?.id || 'main-content';
  const skip = document.createElement('a');
  skip.className = 'skip-link';
  skip.href = `#${mainId}`;
  skip.textContent = 'דלג לתוכן הראשי';
  document.body.insertAdjacentElement('afterbegin', skip);
}

// ═══════════════════════════════════════════════════════════════
// 3. BUTTON LABELER — הוספת aria-label לכפתורים ללא תיאור
// ═══════════════════════════════════════════════════════════════
function enhanceButtons() {
  document.querySelectorAll('button').forEach(btn => {
    // אם כבר יש aria-label מפורש — אל תשנה
    if (btn.getAttribute('aria-label')) return;

    const text = btn.textContent.trim();

    // כפתורים עם אמוג'י בלבד — הוסף תיאור
    const emojiOnlyMap = {
      '☰': 'פתח תפריט ניווט',
      '✕': 'סגור',
      '×': 'סגור',
      '✖': 'סגור',
      '🔄': 'רענן נתונים',
      '←': 'חזרה',
      '→': 'קדימה',
      '❌': 'מחק',
      '✏️': 'ערוך',
      '🔧': 'תחזוקה',
      '🗑️': 'מחק',
      '👁️': 'הצג פרטים',
      '+': 'הוסף',
    };

    const stripped = text.replace(/\s/g, '');
    if (emojiOnlyMap[stripped]) {
      btn.setAttribute('aria-label', emojiOnlyMap[stripped]);
      return;
    }

    // כפתורים עם טקסט — בדוק שהטקסט מספיק תיאורי
    if (!text || text.length < 2) {
      btn.setAttribute('aria-label', 'כפתור');
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 4. MODAL ACCESSIBILITY — מודלים נגישים
// ═══════════════════════════════════════════════════════════════
function enhanceModals() {
  document.querySelectorAll('.modal-backdrop, [role="dialog"], .modal').forEach(el => {
    const isBackdrop = el.classList.contains('modal-backdrop');
    const modal = isBackdrop ? el.querySelector('.modal') : el;

    if (!modal) return;

    // הוסף role ו-aria-modal
    if (!modal.getAttribute('role')) modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    // חפש כותרת בתוך המודל
    const title = modal.querySelector('h2, h3, .modal-title, [class*="title"]');
    if (title) {
      if (!title.id) title.id = 'modal-title-' + Math.random().toString(36).substr(2, 5);
      if (!modal.getAttribute('aria-labelledby')) {
        modal.setAttribute('aria-labelledby', title.id);
      }
    }

    // כפתור סגירה — ודא label ברור
    const closeBtn = modal.querySelector('.modal-close, [onclick*="closeModal"], [onclick*="close"]');
    if (closeBtn && !closeBtn.getAttribute('aria-label')) {
      const modalName = modal.getAttribute('aria-labelledby')
        ? document.getElementById(modal.getAttribute('aria-labelledby'))?.textContent?.trim()
        : '';
      closeBtn.setAttribute('aria-label', modalName ? `סגור חלון ${modalName}` : 'סגור חלון');
    }
  });

  // האזן לפתיחת מודלים ונהל פוקוס
  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        const el = m.target;
        const isModal = el.classList.contains('modal-backdrop') || el.getAttribute('role') === 'dialog';
        if (!isModal) return;

        if (el.classList.contains('open') || el.classList.contains('show')) {
          // מודל נפתח — הזז פוקוס לתוכו
          setTimeout(() => {
            const focusable = el.querySelector('h2, h3, .modal-close, button, input, [tabindex]');
            focusable?.focus();
          }, 100);
          // שמור רפרנס לאיפה היינו לפני
          el._returnFocus = document.activeElement;
          A11y.announce('חלון נפתח: ' + (el.querySelector('h2,h3')?.textContent?.trim() || 'פרטים'));
        } else {
          // מודל נסגר — החזר פוקוס
          if (el._returnFocus) {
            el._returnFocus.focus();
            el._returnFocus = null;
          }
        }
      }
    });
  });

  document.querySelectorAll('.modal-backdrop, [role="dialog"]').forEach(el => {
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}

// ═══════════════════════════════════════════════════════════════
// 5. FORM VALIDATION ACCESSIBILITY
// ═══════════════════════════════════════════════════════════════
function enhanceForms() {
  // ודא כל input מחובר ל-label
  document.querySelectorAll('input, select, textarea').forEach(input => {
    const id = input.id;
    if (!id) return;

    const label = document.querySelector(`label[for="${id}"]`);
    if (!label && !input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby')) {
      // נסה לאתר label קרוב
      const parentLabel = input.closest('label');
      if (!parentLabel) {
        const placeholder = input.getAttribute('placeholder');
        if (placeholder) input.setAttribute('aria-label', placeholder);
      }
    }

    // הוסף aria-required לשדות חובה
    if (input.hasAttribute('required') && !input.getAttribute('aria-required')) {
      input.setAttribute('aria-required', 'true');
    }

    // הוסף aria-invalid כשיש שגיאה (מאזין לשינויי class)
    const observer = new MutationObserver(() => {
      const isInvalid = input.classList.contains('error') ||
                        input.classList.contains('invalid') ||
                        input.getAttribute('aria-invalid') === 'true';
      if (isInvalid) {
        input.setAttribute('aria-invalid', 'true');
      }
    });
    observer.observe(input, { attributes: true, attributeFilter: ['class'] });
  });
}

// ═══════════════════════════════════════════════════════════════
// 6. TABLE ACCESSIBILITY — טבלאות נגישות
// ═══════════════════════════════════════════════════════════════
function enhanceTables() {
  document.querySelectorAll('table').forEach(table => {
    // הוסף role="table" אם חסר
    if (!table.getAttribute('role') && !table.closest('[role="table"]')) {
      table.setAttribute('role', 'table');
    }

    // scope לכותרות עמודות
    table.querySelectorAll('thead th').forEach(th => {
      if (!th.getAttribute('scope')) th.setAttribute('scope', 'col');
    });

    // scope לכותרות שורות (עמודה ראשונה)
    table.querySelectorAll('tbody tr').forEach(tr => {
      const firstCell = tr.querySelector('th');
      if (firstCell && !firstCell.getAttribute('scope')) {
        firstCell.setAttribute('scope', 'row');
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 7. NAVIGATION TABS — תפריטי ניווט בתור tabs
// ═══════════════════════════════════════════════════════════════
function enhanceNavTabs() {
  // rider.html — שורת הניווט התחתית
  const bottomNav = document.querySelector('.bottom-nav, nav[aria-label*="ניווט"]');
  if (bottomNav) {
    const navButtons = bottomNav.querySelectorAll('button.nav-btn, button[id^="nav-"]');
    if (navButtons.length > 0) {
      if (!bottomNav.getAttribute('role')) bottomNav.setAttribute('role', 'tablist');
      navButtons.forEach(btn => {
        if (!btn.getAttribute('role')) btn.setAttribute('role', 'tab');
        const isActive = btn.classList.contains('active');
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');

        // התאם את ה-aria של הpanel המתאים
        const target = btn.id?.replace('nav-', 'section-');
        if (target) {
          const panel = document.getElementById(target);
          if (panel) {
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', btn.id);
          }
        }
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 8. TOAST / NOTIFICATIONS — הכרזה על הודעות
// ═══════════════════════════════════════════════════════════════
function patchToastFunction() {
  // עוטף את פונקציית showToast המקורית
  if (typeof window.showToast === 'function') {
    const originalShowToast = window.showToast;
    window.showToast = function(msg, type = 'info') {
      originalShowToast.call(this, msg, type);
      // הכרז דרך live region
      if (type === 'error') {
        A11y.announceUrgent(msg);
      } else {
        A11y.announce(msg);
      }
    };
  }

  // מאזין לשינויים בתיבות toast/alert
  const toastObserver = new MutationObserver(mutations => {
    mutations.forEach(m => {
      const el = m.target;
      if (el.classList?.contains('toast') || el.classList?.contains('alert')) {
        if (el.classList.contains('show') || el.classList.contains('visible')) {
          const text = el.textContent?.trim();
          if (text) {
            const isError = el.classList.contains('error') ||
                            el.classList.contains('danger') ||
                            el.getAttribute('role') === 'alert';
            if (isError) {
              A11y.announceUrgent(text);
            } else {
              A11y.announce(text);
            }
          }
        }
      }
    });
  });

  document.querySelectorAll('.toast, .alert, #alertError, #alertBlocked').forEach(el => {
    toastObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}

// ═══════════════════════════════════════════════════════════════
// 9. LOADING STATES — הכרזה על מצבי טעינה
// ═══════════════════════════════════════════════════════════════
function enhanceLoadingStates() {
  // כפתורים שנהיים disabled — הכרז
  document.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;

    // מאזין לשינויים ב-disabled
    const observer = new MutationObserver(() => {
      if (btn.disabled) {
        btn.setAttribute('aria-busy', 'true');
      } else {
        btn.removeAttribute('aria-busy');
      }
    });
    observer.observe(btn, { attributes: true, attributeFilter: ['disabled'] });
  });
}

// ═══════════════════════════════════════════════════════════════
// 10. PAGE-SPECIFIC ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════

function enhanceLoginPage() {
  if (!document.getElementById('loginForm')) return;

  // כרטיס הכניסה
  const card = document.querySelector('.card');
  if (card) {
    card.setAttribute('role', 'main');
    card.setAttribute('aria-label', 'כניסה למערכת קבוצת אופניים');
  }

  // כפתור הכניסה
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.setAttribute('aria-label', 'כניסה למערכת — לחץ לאישור הפרטים');
    loginBtn.setAttribute('aria-describedby', 'phone-hint name-hint');
  }

  // הוסף הנחיות לשדות
  const phoneInput = document.getElementById('phone');
  if (phoneInput) {
    phoneInput.setAttribute('inputmode', 'tel');
    phoneInput.setAttribute('autocomplete', 'tel');
    phoneInput.setAttribute('aria-label', 'מספר טלפון — הזן את מספר הטלפון הרשום במערכת');
  }

  const nameInput = document.getElementById('name');
  if (nameInput) {
    nameInput.setAttribute('autocomplete', 'name');
    nameInput.setAttribute('aria-label', 'שם מלא — הזן את שמך כפי שנרשם בקבוצה');
  }
}

function enhanceRiderPage() {
  if (!document.getElementById('section-events') &&
      !document.getElementById('nav-events')) return;

  // ניווט תחתון — tab pattern
  const navBtns = document.querySelectorAll('#nav-events, #nav-history, #nav-phonebook');
  if (navBtns.length) {
    const navContainer = navBtns[0].closest('nav, .bottom-nav, .bottom-bar');
    if (navContainer && !navContainer.getAttribute('role')) {
      navContainer.setAttribute('role', 'tablist');
      navContainer.setAttribute('aria-label', 'ניווט ראשי');
    }
    navBtns.forEach(btn => {
      btn.setAttribute('role', 'tab');
      const isActive = btn.classList.contains('active');
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  // header — ודא label על אזור המשתמש
  const headerName = document.getElementById('headerName');
  if (headerName) {
    const parent = headerName.closest('.header-user, div');
    if (parent) parent.setAttribute('aria-label', 'פרטי משתמש מחובר');
  }

  // כפתורי פגינציה בהיסטוריה
  const prevBtn = document.getElementById('prevPage');
  const nextBtn = document.getElementById('nextPage');
  const pageInfo = document.getElementById('pageInfo');
  if (prevBtn) prevBtn.setAttribute('aria-label', 'עמוד קודם');
  if (nextBtn) nextBtn.setAttribute('aria-label', 'עמוד הבא');
  if (pageInfo) pageInfo.setAttribute('role', 'status');

  // פילטרים בהיסטוריה
  const yearFilter  = document.getElementById('filterYear');
  const eventFilter = document.getElementById('filterEventSearch');
  if (yearFilter && !yearFilter.getAttribute('aria-label'))
    yearFilter.setAttribute('aria-label', 'סנן לפי שנה');
  if (eventFilter && !eventFilter.getAttribute('aria-label'))
    eventFilter.setAttribute('aria-label', 'חיפוש לפי שם אירוע');
}

function enhanceAdminPage() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // כפתור המבורגר
  const menuToggle = document.getElementById('menuToggle');
  if (menuToggle && !menuToggle.getAttribute('aria-label')) {
    menuToggle.setAttribute('aria-label', 'פתח תפריט ניווט');
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-controls', 'sidebar');
  }

  // כפתורי פעולות בטבלאות — הוסף תיאור ברור
  document.querySelectorAll('[onclick*="openEditRider"], [onclick*="editRider"]').forEach(btn => {
    if (!btn.getAttribute('aria-label')) {
      const row = btn.closest('tr');
      const name = row?.querySelector('.td-name, td:first-child')?.textContent?.trim();
      if (name) btn.setAttribute('aria-label', `ערוך רוכב: ${name}`);
    }
  });

  document.querySelectorAll('[onclick*="deleteRider"]').forEach(btn => {
    if (!btn.getAttribute('aria-label')) {
      const row = btn.closest('tr');
      const name = row?.querySelector('.td-name, td:first-child')?.textContent?.trim();
      if (name) btn.setAttribute('aria-label', `מחק רוכב: ${name}`);
    }
  });

  // כפתורי ניווט בסיידבר — הוסף aria-current לפעיל
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.setAttribute('role', 'menuitem');
    if (btn.classList.contains('active') && !btn.getAttribute('aria-current')) {
      btn.setAttribute('aria-current', 'page');
    }
  });

  // select אירוע בשיבוצים
  const assignSelect = document.getElementById('event-select-assign');
  if (assignSelect && !assignSelect.getAttribute('aria-label')) {
    assignSelect.setAttribute('aria-label', 'בחר אירוע לצפייה בשיבוצים');
  }

  // שדות חיפוש
  const riderSearch = document.getElementById('riderSearch');
  if (riderSearch && !riderSearch.getAttribute('aria-label'))
    riderSearch.setAttribute('aria-label', 'חיפוש רוכב לפי שם, טלפון, או עיר');

  // לשוניות ניווט
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (!item.getAttribute('role')) item.setAttribute('role', 'menuitem');
  });

  // כרטיסי סטטיסטיקה — הוסף role
  document.querySelectorAll('.stat-card').forEach(card => {
    if (!card.getAttribute('role')) card.setAttribute('role', 'figure');
    const value = card.querySelector('.stat-value');
    const label = card.querySelector('.stat-label');
    if (value && label && !value.getAttribute('aria-label')) {
      value.setAttribute('aria-label', `${label.textContent.trim()}: ${value.textContent.trim()}`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 11. EMOJI IN TEXT — הסתרת אמוג'י ויזואלי מקוראי מסך
// ═══════════════════════════════════════════════════════════════
function hideDecorativeEmoji() {
  // אמוג'י standalone שאינם בתוך span עם aria-hidden
  // אנו לא משנים DOM אלא מוסיפים CSS לאלמנטים ייעודיים
  document.querySelectorAll('.nav-icon, .stat-icon, .empty-icon, .alert-icon').forEach(el => {
    if (!el.getAttribute('aria-hidden')) {
      el.setAttribute('aria-hidden', 'true');
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 12. KEYBOARD NAVIGATION — ניווט מקלדת
// ═══════════════════════════════════════════════════════════════
function enhanceKeyboardNav() {
  // ESC סוגר מודלים
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.modal-backdrop.open, [role="dialog"][aria-hidden="false"]');
      if (openModal) {
        const closeBtn = openModal.querySelector('.modal-close, [onclick*="closeModal"]');
        if (closeBtn) closeBtn.click();
        else {
          openModal.classList.remove('open');
          openModal.setAttribute('aria-hidden', 'true');
        }
        A11y.announce('החלון נסגר');
      }
    }
  });

  // Arrow keys לניווט בין tab buttons
  document.querySelectorAll('[role="tablist"]').forEach(tablist => {
    tablist.addEventListener('keydown', e => {
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
      const current = tabs.indexOf(document.activeElement);
      if (current === -1) return;

      let next = current;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        next = (current - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        next = (current + 1) % tabs.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        next = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        next = tabs.length - 1;
      }

      if (next !== current) {
        tabs[next].focus();
        tabs[next].click();
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// 13. DYNAMIC CONTENT OBSERVER — עדכון נגישות לתוכן דינמי
// ═══════════════════════════════════════════════════════════════
function observeDynamicContent() {
  const targets = [
    '#eventsList', '#historyList', '#contactList',
    '#ridersTable tbody', '#bikesBody', '#examsBody',
    '#dashEventsBody', '#captainsBody'
  ];

  const observer = new MutationObserver(debounce(() => {
    enhanceButtons();
    enhanceTables();
    hideDecorativeEmoji();
    if (document.getElementById('sidebar')) enhanceAdminPage();
  }, 300));

  targets.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) observer.observe(el, { childList: true, subtree: true });
  });
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ═══════════════════════════════════════════════════════════════
// 14. EXPOSE ANNOUNCE TO GLOBAL SCOPE
//     כדי ש-JavaScript אחר בדף יוכל להכריז הודעות
// ═══════════════════════════════════════════════════════════════
window.a11yAnnounce       = A11y.announce;
window.a11yAnnounceUrgent = A11y.announceUrgent;

// ═══════════════════════════════════════════════════════════════
// INIT — הפעל הכל אחרי טעינת ה-DOM
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  A11y.init();
  ensureSkipLink();
  enhanceButtons();
  enhanceForms();
  enhanceTables();
  enhanceModals();
  enhanceNavTabs();
  hideDecorativeEmoji();
  enhanceKeyboardNav();
  patchToastFunction();
  enhanceLoadingStates();
  observeDynamicContent();

  // שיפורים ספציפיים לכל דף
  enhanceLoginPage();
  enhanceRiderPage();
  enhanceAdminPage();

  // הכרזה על שם הדף לקוראי מסך
  const pageTitle = document.title;
  if (pageTitle) {
    setTimeout(() => A11y.announce(`עמוד: ${pageTitle}`), 500);
  }
});
