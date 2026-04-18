# מדריך שיפורי נגישות — VoiceOver & TalkBack
## קבוצת אופניים | login.html · rider.html · admin.html

---

## שלב 1 — הוסף את הקובץ לכל שלושת הדפים

בכל אחד מהדפים, לפני תג `</body>`, הוסף:

```html
<script src="accessibility.js" defer></script>
```

---

## שלב 2 — שינויים ידניים ב-login.html

### א. תג `<html>` — ודא lang ו-dir
```html
<html lang="he" dir="rtl">
```

### ב. `<main>` — הוסף landmark
```html
<main role="main" id="main-content" tabindex="-1" aria-label="כניסה למערכת">
```

### ג. הודעת שגיאה — הוסף role="alert"
```html
<div id="alertError"
     class="alert alert-error"
     role="alert"
     aria-live="assertive"
     aria-atomic="true"
     tabindex="-1">
  <span class="alert-icon" aria-hidden="true">⚠️</span>
  <span id="alertErrorText"></span>
</div>
```

### ד. הודעת חסום — הוסף role="alert"
```html
<div id="alertBlocked"
     class="alert alert-blocked"
     role="alert"
     aria-live="assertive"
     aria-atomic="true"
     tabindex="-1">
```

### ה. כפתור הכניסה — שיפור label
```html
<button type="submit"
        id="loginBtn"
        class="btn-login"
        aria-label="כניסה למערכת — לחץ לאחר מילוי הטלפון והשם"
        aria-describedby="phone-hint name-hint">
  <span class="btn-text" aria-hidden="false">כניסה למערכת ←</span>
  <span class="spinner" aria-hidden="true" role="presentation"></span>
</button>
```

---

## שלב 3 — שינויים ידניים ב-rider.html

### א. ניווט תחתון — tablist pattern
```html
<nav role="tablist" aria-label="ניווט ראשי">
  <button id="nav-events"
          role="tab"
          aria-selected="true"
          aria-controls="section-events"
          class="nav-btn active"
          onclick="switchTab('events')">
    <span aria-hidden="true">📅</span>
    <span>רכיבות</span>
  </button>

  <button id="nav-history"
          role="tab"
          aria-selected="false"
          aria-controls="section-history"
          class="nav-btn"
          onclick="switchTab('history')">
    <span aria-hidden="true">📊</span>
    <span>היסטוריה</span>
  </button>

  <button id="nav-phonebook"
          role="tab"
          aria-selected="false"
          aria-controls="section-phonebook"
          class="nav-btn"
          onclick="switchTab('phonebook')">
    <span aria-hidden="true">📞</span>
    <span>אנשי קשר</span>
  </button>
</nav>
```

### ב. sections — tabpanel pattern
```html
<section id="section-events"
         role="tabpanel"
         aria-labelledby="nav-events"
         tabindex="0">

<section id="section-history"
         role="tabpanel"
         aria-labelledby="nav-history"
         tabindex="0"
         hidden>

<section id="section-phonebook"
         role="tabpanel"
         aria-labelledby="nav-phonebook"
         tabindex="0"
         hidden>
```

### ג. שינוי ב-switchTab() — עדכן aria-selected
```javascript
async function switchTab(name) {
  TABS.forEach(t => {
    const sec = document.getElementById('section-' + t);
    const btn = document.getElementById('nav-' + t);
    if (t === name) {
      sec.classList.add('active');
      sec.hidden = false;
      sec.removeAttribute('hidden');
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');
      btn.setAttribute('aria-selected', 'true');  // ← הוסף
    } else {
      sec.classList.remove('active');
      sec.hidden = true;
      btn.classList.remove('active');
      btn.removeAttribute('aria-current');
      btn.setAttribute('aria-selected', 'false');  // ← הוסף
    }
  });
  document.getElementById('main-content').focus();
  // הכרז על המעבר
  window.a11yAnnounce?.('מציג: ' + name);
  // ... המשך הקוד הקיים
}
```

### ד. כרטיסי אירועים — שיפור renderEvents()
בתוך renderEvents(), שנה את ה-article:
```javascript
return `
<article class="event-card ${isReg ? 'registered' : ''}"
         role="article"
         aria-label="רכיבה: ${esc(ev.description)}, תאריך ${esc(ev.date)}, ${esc(String(ev.km))} קילומטר, ${esc(String(ev.climb))} מטר עלייה${isReg ? ', נרשמת לרכיבה זו' : ''}">
  ...
  <div class="event-meta" role="list" aria-label="פרטי הרכיבה">
    <div class="meta-chip" role="listitem" aria-label="נקודת מפגש: ${esc(ev.meetPoint)}">
      <span aria-hidden="true">📍</span>
      <span>${esc(ev.meetPoint)}</span>
    </div>
    <div class="meta-chip" role="listitem" aria-label="מרחק: ${esc(String(ev.km))} קילומטר">
      <span aria-hidden="true">🚴</span>
      <strong>${esc(String(ev.km))}</strong>&nbsp;ק"מ
    </div>
    <div class="meta-chip" role="listitem" aria-label="עלייה: ${esc(String(ev.climb))} מטר">
      <span aria-hidden="true">⛰️</span>
      <strong>${esc(String(ev.climb))}</strong>&nbsp;מ' עלייה
    </div>
    <div class="meta-chip" role="listitem" aria-label="קפטן: ${esc(ev.captain)}">
      <span aria-hidden="true">👑</span>
      <span>${esc(ev.captain)}</span>
    </div>
  </div>
  ...
```

### ה. כפתורי ניהול הרשמה — הוסף ל-register()/cancelReg()
```javascript
async function register(eventId, eventName, btn) {
  if (registering) return;
  registering = true;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.setAttribute('aria-label', `מתבצע רישום לרכיבה ${eventName}...`);
  btn.textContent = '...';
  // ...
  // אחרי הצלחה:
  window.a11yAnnounce?.(`נרשמת לרכיבה ${eventName}. ✅`);
  // ...
}

async function cancelReg(eventId, eventName, btn) {
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.setAttribute('aria-label', `מבטל הרשמה לרכיבה ${eventName}...`);
  // ...
  // אחרי הצלחה:
  window.a11yAnnounce?.(`ההרשמה לרכיבה ${eventName} בוטלה.`);
  // ...
}
```

### ו. סטטיסטיקות היסטוריה — הוסף aria-label
```html
<div class="stats-row" role="list" aria-label="סטטיסטיקות רכיבות אישיות">
  <div class="stat-item" role="listitem">
    <div class="stat-num" id="statRides" aria-label="מספר רכיבות: טוען">—</div>
    <div class="stat-lbl" aria-hidden="true">רכיבות</div>
  </div>
  <div class="stat-item" role="listitem">
    <div class="stat-num" id="statKm" aria-label="קילומטרים מצטברים: טוען">—</div>
    <div class="stat-lbl" aria-hidden="true">ק"מ</div>
  </div>
  <div class="stat-item" role="listitem">
    <div class="stat-num" id="statClimb" aria-label="מטרי עלייה מצטברים: טוען">—</div>
    <div class="stat-lbl" aria-hidden="true">מ' עלייה</div>
  </div>
</div>
```

---

## שלב 4 — שינויים ידניים ב-admin.html

### א. כפתור המבורגר — ניהול מצב
```html
<button class="menu-toggle" id="menuToggle"
        aria-label="פתח תפריט ניווט ראשי"
        aria-expanded="false"
        aria-controls="sidebar"
        onclick="toggleSidebar()">
  <span aria-hidden="true">☰</span>
</button>
```

עדכן toggleSidebar():
```javascript
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle  = document.getElementById('menuToggle');
  const isOpen  = sidebar.classList.toggle('open');
  toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  toggle.setAttribute('aria-label', isOpen ? 'סגור תפריט ניווט' : 'פתח תפריט ניווט ראשי');
  document.getElementById('overlay').setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}
```

### ב. מודלים — הוסף role="dialog" ו-aria-modal
לכל מודל (modalAddRider, modalEditRider, modalAddEvent, וכו'):
```html
<div class="modal-backdrop" id="modalAddRider">
  <div class="modal"
       role="dialog"
       aria-modal="true"
       aria-labelledby="modal-add-rider-title"
       aria-describedby="modal-add-rider-desc">

    <div class="modal-header">
      <h2 id="modal-add-rider-title">הוספת רוכב חדש</h2>
      <p id="modal-add-rider-desc" class="sr-only">
        מלא את הפרטים הנדרשים להוספת רוכב חדש לקבוצה. שדות המסומנים בכוכבית הם חובה.
      </p>
      <button class="modal-close"
              aria-label="סגור חלון הוספת רוכב"
              onclick="closeModal('modalAddRider')">✕</button>
    </div>
    ...
  </div>
</div>
```

### ג. שדות טופס — labels ברורים לכל שדה
```html
<!-- תעודת זהות -->
<label for="new-tid">תעודת זהות <span aria-hidden="true">*</span><span class="sr-only">(חובה)</span></label>
<input type="text" id="new-tid" inputmode="numeric" maxlength="9"
       aria-required="true"
       aria-describedby="tid-hint"
       placeholder="9 ספרות">
<span id="tid-hint" class="sr-only">הזן מספר תעודת זהות בת 9 ספרות</span>

<!-- תאריך לידה -->
<label for="new-dob">תאריך לידה <span aria-hidden="true">*</span><span class="sr-only">(חובה)</span></label>
<input type="date" id="new-dob"
       aria-required="true"
       aria-label="תאריך לידה — בחר תאריך מהלוח">

<!-- תפקיד -->
<label for="new-style">סגנון רכיבה <span aria-hidden="true">*</span><span class="sr-only">(חובה)</span></label>
<select id="new-style" aria-required="true" aria-label="בחר סגנון רכיבה: קפטן, סטוקר, או סינגל">
  <option value="">בחר תפקיד</option>
  <option value="קפטן">קפטן (מוביל)</option>
  <option value="סטוקר">סטוקר (אחורי)</option>
  <option value="סינגל">סינגל</option>
</select>
```

### ד. פעולות בטבלת רוכבים — labels עם שם הרוכב
בפונקציה שמרנדרת שורות הטבלה:
```javascript
// בתוך renderRidersTable()
`<button class="btn btn-ghost btn-sm"
         aria-label="ערוך רוכב: ${esc(r.name)}"
         onclick="openEditRider('${esc(r.tid)}')">
  <span aria-hidden="true">✏️</span> ערוך
</button>
<button class="btn btn-danger btn-sm"
         aria-label="מחק רוכב: ${esc(r.name)} — פעולה בלתי הפיכה"
         onclick="deleteRider('${esc(r.tid)}','${esc(r.name)}')">
  <span aria-hidden="true">🗑️</span> מחק
</button>`
```

### ה. שיבוץ אופניים — label ברור
```javascript
// בפונקציה שמרנדרת שיבוצים
`<button class="btn btn-primary btn-sm"
         aria-label="שבץ אופניים ל${esc(pair.captain)} ו${esc(pair.stoker)}"
         onclick="assignBike(...)">
  שבץ אופניים
</button>`
```

---

## שלב 5 — בדיקה עם קורא מסך

### VoiceOver (iPhone/iPad):
1. **הפעל:** הגדרות ← נגישות ← VoiceOver ← הפעל
2. **ניווט בדף:** החלק ימינה/שמאלה בין אלמנטים
3. **הפעל לחצן:** לחץ פעמיים מהיר
4. **לחץ Tab:** גרור עם שתי אצבעות ← /→

### TalkBack (Android):
1. **הפעל:** הגדרות ← נגישות ← TalkBack ← הפעל
2. **ניווט:** החלק ימינה לאלמנט הבא, שמאלה לקודם
3. **הפעל:** הקש פעמיים

### נקודות בדיקה עיקריות:
- [ ] קורא מסך מכריז את שם הדף
- [ ] ניווט Tab עובר בסדר הגיוני (ימין לשמאל בעברית)
- [ ] כל לחצן מתואר בבירור ("הירשם לרכיבה שישי 25.4" ולא רק "הירשם")
- [ ] שגיאות טופס מוכרזות מיד
- [ ] פתיחת מודל — הפוקוס עובר לתוכו
- [ ] סגירת מודל — הפוקוס חוזר ללחצן שפתח
- [ ] הודעות toast מוכרזות בקול

---

## סיכום מה-accessibility.js עושה אוטומטית

| תכונה | תיאור |
|-------|--------|
| Live Regions | הכרזה אוטומטית על toast, שגיאות, שינויי מצב |
| Skip Link | קישור "דלג לתוכן" מופיע בפוקוס ראשון |
| Button Labels | מזהה כפתורים ללא תיאור ומוסיף aria-label |
| Modal Focus | מנהל פוקוס בפתיחה/סגירת מודלים |
| Tab Pattern | ממיר ניווט ל-tablist/tab/tabpanel |
| Form Hints | מחבר inputs ל-labels ומוסיף aria-required |
| Table Scope | מוסיף scope="col/row" לטבלאות |
| Emoji Hide | מסתיר אמוג'י דקורטיביים מקוראי מסך |
| Keyboard Nav | ESC סוגר מודלים, Arrow keys בין tabs |
| Dynamic Update | מרענן ARIA לתוכן שנטען דינמית |
