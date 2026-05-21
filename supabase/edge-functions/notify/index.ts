// ═══════════════════════════════════════════════════════════════
// Supabase Edge Function: notify
// תפקיד: שליחת מיילים לרוכבים ומנהלים דרך Gmail SMTP או כל שרת SMTP אחר.
// הגדרות SMTP נשמרות ב-smtp_settings table ומוגנות ב-service role.
//
// פריסה: supabase functions deploy notify
//
// משתני סביבה (אוטומטיים ב-Supabase):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const _sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  try {
    const { type, payload } = await req.json();
    console.log('[notify] type:', type);

    const { data: smtp, error: smtpErr } = await _sb
      .from('smtp_settings').select('*').single();

    if (smtpErr) {
      console.error('[notify] smtp_settings error:', JSON.stringify(smtpErr));
      return json({ error: 'שגיאה בקריאת הגדרות SMTP', detail: smtpErr.message }, 500);
    }
    if (!smtp?.smtp_user) {
      console.error('[notify] smtp_settings empty — run schema.sql and save settings in admin panel');
      return json({ error: 'SMTP לא מוגדר. הגדר הגדרות SMTP בדף הניהול.' }, 500);
    }
    console.log('[notify] smtp host:', smtp.host, 'user:', smtp.smtp_user);

    const fromAddr = `${smtp.from_name} <${smtp.smtp_user}>`;
    const emails   = buildEmails(type, payload, fromAddr, smtp.from_name);

    if (!emails.length) return json({ queued: 0 });

    const cfg: SmtpCfg = {
      host: smtp.host,
      port: smtp.port,
      user: smtp.smtp_user,
      pass: smtp.smtp_pass,
    };

    // שלח ברקע — החזר תשובה מיידית לפני שה-SMTP מתחבר
    const sendTask = (async () => {
      for (const m of emails) {
        try {
          await sendSmtpMail(cfg, m);
          console.log('[notify] sent to:', Array.isArray(m.to) ? m.to.join(',') : m.to);
        } catch (e) {
          console.error('[notify] send error:', String(e));
        }
      }
    })();

    // שמור את ה-function חי עד שהמשימה הברקע מסתיימת
    EdgeRuntime.waitUntil(sendTask);

    return json({ queued: emails.length });

  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

// ─── smtp client ──────────────────────────────────────────────

interface SmtpCfg { host: string; port: number; user: string; pass: string; }

async function sendSmtpMail(cfg: SmtpCfg, mail: Mail): Promise<void> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function toB64(s: string): string {
    const bytes = enc.encode(s);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  // RFC 2045 — שורות base64 מקסימום 76 תווים
  function toB64Wrapped(s: string): string {
    const b = toB64(s);
    return b.match(/.{1,76}/g)?.join('\r\n') ?? b;
  }

  // RFC 2047 — קידוד נושא בעברית
  function encodeSubject(s: string): string {
    return `=?UTF-8?B?${toB64(s)}?=`;
  }

  const conn = await Deno.connectTls({ hostname: cfg.host, port: cfg.port });
  let readBuf = '';
  const readRaw = new Uint8Array(65536);

  // קרא תגובת SMTP מלאה (תמיכה בתגובות רב-שורה 250-...)
  async function readResp(): Promise<string> {
    while (true) {
      const lines = readBuf.split('\r\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // שורה סופית: NNN<space>text (לא NNN-text)
        if (line.length >= 4 && line[3] === ' ') {
          const resp = lines.slice(0, i + 1).join('\r\n');
          readBuf = lines.slice(i + 1).join('\r\n');
          return resp;
        }
      }
      const n = await conn.read(readRaw);
      if (!n) throw new Error('SMTP connection closed unexpectedly');
      readBuf += dec.decode(readRaw.subarray(0, n));
    }
  }

  async function cmd(line: string): Promise<string> {
    await conn.write(enc.encode(line + '\r\n'));
    return readResp();
  }

  try {
    await readResp(); // greeting

    const ehlo = await cmd('EHLO localhost');
    if (!ehlo.startsWith('2')) throw new Error('EHLO failed: ' + ehlo.slice(0, 80));

    await cmd('AUTH LOGIN');
    await cmd(toB64(cfg.user));
    const auth = await cmd(toB64(cfg.pass));
    if (!auth.startsWith('2')) throw new Error('AUTH failed: ' + auth.slice(0, 80));

    const fromRaw = mail.from.match(/<([^>]+)>/)?.[1] ?? cfg.user;
    await cmd(`MAIL FROM:<${fromRaw}>`);

    const toList = Array.isArray(mail.to) ? mail.to : [mail.to];
    for (const addr of [...toList, ...(mail.cc ?? [])]) {
      const a = addr.match(/<([^>]+)>/)?.[1] ?? addr;
      await cmd(`RCPT TO:<${a}>`);
    }

    const dataResp = await cmd('DATA');
    if (!dataResp.startsWith('3')) throw new Error('DATA failed: ' + dataResp.slice(0, 80));

    const headers = [
      'MIME-Version: 1.0',
      `Date: ${new Date().toUTCString()}`,
      `From: ${mail.from}`,
      `To: ${toList.join(', ')}`,
      ...(mail.cc?.length ? [`Cc: ${mail.cc.join(', ')}`] : []),
      `Subject: ${encodeSubject(mail.subject)}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
    ].join('\r\n');

    await conn.write(enc.encode(headers + '\r\n' + toB64Wrapped(mail.html) + '\r\n.\r\n'));

    const sent = await readResp();
    if (!sent.startsWith('2')) throw new Error('Message rejected: ' + sent.slice(0, 80));

    await cmd('QUIT');
  } finally {
    try { conn.close(); } catch (_) {}
  }
}

// ─── helpers ──────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

type Mail = { from: string; to: string | string[]; cc?: string[]; subject: string; text: string; html: string };

function wrap(content: string, clubName: string): string {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:Arial,sans-serif;direction:rtl;text-align:right;background:#f5f5f5;margin:0;padding:20px}
  .card{background:#fff;border-radius:12px;padding:28px 32px;max-width:520px;margin:0 auto;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .logo{font-size:1.1rem;font-weight:800;color:#4f7cff;margin-bottom:20px}
  h1{font-size:1.15rem;margin:0 0 16px;color:#111}
  p{color:#444;line-height:1.6;margin:0 0 12px}
  .box{background:#f8f9ff;border-radius:8px;padding:14px 16px;margin:16px 0}
  .row{margin-bottom:6px;font-size:.9rem}
  .lbl{color:#888;font-size:.78rem;display:block}
  .foot{color:#aaa;font-size:.75rem;margin-top:24px;border-top:1px solid #eee;padding-top:12px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">🚴 ${esc(clubName)}</div>
  ${content}
  <div class="foot">הודעה זו נשלחה ממערכת ניהול קבוצת האופניים. אין להשיב למייל זה.</div>
</div>
</body>
</html>`;
}

// ─── router ───────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function buildEmails(type: string, p: any, from: string, clubName: string): Mail[] {
  switch (type) {
    case 'exam_reminder':               return buildExamReminder(p, from, clubName);
    case 'exam_no_email':               return [buildExamNoEmail(p, from, clubName)];
    case 'event_registered':            return [buildEventRegistered(p, from, clubName)];
    case 'event_registration_by_admin': return [buildEventRegByAdmin(p, from, clubName)];
    case 'event_cancelled':             return buildEventCancelled(p, from, clubName);
    case 'new_event':                   return buildNewEvent(p, from, clubName);
    case 'smtp_test':                   return [buildSmtpTest(p, from, clubName)];
    case 'birthday':                    return buildBirthday(p, from, clubName);
    default: throw new Error('סוג הודעה לא מוכר: ' + type);
  }
}

// ─── templates ────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function buildExamReminder(p: any, from: string, clubName: string): Mail[] {
  const adminEmails: string[] = p.adminEmails || [];
  // deno-lint-ignore no-explicit-any
  return (p.recipients as any[]).map(r => {
    const urgent = r.daysLeft <= 7 ? '🚨' : '⚠️';
    const subject = `${urgent} הבדיקה הארגומטרית שלך פוגת תוקף בעוד ${r.daysLeft} ימים`;
    const text = `שלום ${r.name},\n\nהבדיקה הארגומטרית שלך פוגת תוקף בעוד ${r.daysLeft} ימים.\nאנא קבע תור לבדיקה בהקדם.\n\n${clubName}`;
    const html = wrap(`
      <h1>${urgent} תזכורת: בדיקה ארגומטרית</h1>
      <p>שלום <strong>${esc(r.name)}</strong>,</p>
      <p>הבדיקה הארגומטרית שלך פוגת תוקף בעוד <strong>${esc(r.daysLeft)} ימים</strong>.</p>
      <p>אנא קבע תור לבדיקה בהקדם כדי להמשיך להשתתף בפעילויות הקבוצה.</p>
    `, clubName);
    const mail: Mail = { from, to: r.email, subject, text, html };
    if (adminEmails.length) mail.cc = adminEmails;
    return mail;
  });
}

// deno-lint-ignore no-explicit-any
function buildExamNoEmail(p: any, from: string, clubName: string): Mail {
  // deno-lint-ignore no-explicit-any
  const lines    = (p.riders as any[]).map((r: any) => `• ${r.name} — ${r.daysLeft} ימים`).join('\n');
  // deno-lint-ignore no-explicit-any
  const htmlRows = (p.riders as any[]).map((r: any) => `<div class="row">• <strong>${esc(r.name)}</strong> — ${esc(r.daysLeft)} ימים</div>`).join('');
  const subject  = `ℹ️ ${p.riders.length} רוכבים ללא כתובת מייל לתזכורת בדיקה`;
  const text     = `שלום,\n\nהרוכבים הבאים זקוקים לתזכורת בדיקה ארגומטרית אך אין להם כתובת מייל:\n\n${lines}\n\nאנא צור איתם קשר ישירות.\n\n${clubName}`;
  const html     = wrap(`
    <h1>ℹ️ רוכבים ללא כתובת מייל</h1>
    <p>הרוכבים הבאים זקוקים לתזכורת בדיקה ארגומטרית, אך <strong>אין להם כתובת מייל</strong> במערכת:</p>
    <div class="box">${htmlRows}</div>
    <p>אנא צור איתם קשר ישירות.</p>
  `, clubName);
  return { from, to: p.adminEmails, subject, text, html };
}

// deno-lint-ignore no-explicit-any
function buildEventRegistered(p: any, from: string, clubName: string): Mail {
  const ev = p.event;
  const subject = `✅ נרשמת לרכיבה: ${ev.description}`;
  const text    = `שלום ${p.name},\n\nנרשמת בהצלחה לרכיבה:\n${ev.description}\nתאריך: ${ev.date}\nשעת מפגש: ${ev.meetTime || '06:00'}\nנקודת מפגש: ${ev.meetPoint || '—'}\nמרחק: ${ev.km} ק"מ | עלייה: ${ev.climb} מ'\n\n${clubName}`;
  const html    = wrap(`
    <h1>✅ נרשמת לרכיבה!</h1>
    <p>שלום <strong>${esc(p.name)}</strong>, נרשמת בהצלחה לרכיבה הבאה:</p>
    ${evBox(ev)}
    <p>נתראה ברכיבה! 🚴</p>
  `, clubName);
  return { from, to: p.email, subject, text, html };
}

// deno-lint-ignore no-explicit-any
function buildEventRegByAdmin(p: any, from: string, clubName: string): Mail {
  const ev = p.event;
  const subject = `✅ נרשמת לרכיבה: ${ev.description}`;
  const text    = `שלום ${p.name},\n\nהמנהל ${p.registeredBy} רשם אותך לרכיבה:\n${ev.description}\nתאריך: ${ev.date}\nשעת מפגש: ${ev.meetTime || '06:00'}\nנקודת מפגש: ${ev.meetPoint || '—'}\n\n${clubName}`;
  const html    = wrap(`
    <h1>✅ נרשמת לרכיבה!</h1>
    <p>שלום <strong>${esc(p.name)}</strong>,<br>המנהל <strong>${esc(p.registeredBy)}</strong> רשם אותך לרכיבה הבאה:</p>
    ${evBox(ev)}
    <p>נתראה ברכיבה! 🚴</p>
  `, clubName);
  return { from, to: p.email, subject, text, html };
}

// deno-lint-ignore no-explicit-any
function buildEventCancelled(p: any, from: string, clubName: string): Mail[] {
  const ev = p.event;
  // deno-lint-ignore no-explicit-any
  return (p.riders as any[]).map(r => {
    const subject = `❌ הרכיבה "${ev.description}" בוטלה`;
    const text    = `שלום ${r.name},\n\nלצערנו הרכיבה "${ev.description}" (${ev.date}) בוטלה.\n\nנתראה ברכיבה הבאה!\n\n${clubName}`;
    const html    = wrap(`
      <h1>❌ הרכיבה בוטלה</h1>
      <p>שלום <strong>${esc(r.name)}</strong>,</p>
      <p>לצערנו הרכיבה <strong>"${esc(ev.description)}"</strong> שתוכננה לתאריך <strong>${esc(ev.date)}</strong> בוטלה.</p>
      <p>נתראה ברכיבה הבאה! 🚴</p>
    `, clubName);
    return { from, to: r.email, subject, text, html };
  });
}

// deno-lint-ignore no-explicit-any
function buildNewEvent(p: any, from: string, clubName: string): Mail[] {
  const ev = p.event;
  // deno-lint-ignore no-explicit-any
  return (p.riders as any[]).map(r => {
    const subject = `🚴 רכיבה חדשה: ${ev.description} — ${ev.date}`;
    const text    = `שלום ${r.name},\n\nרכיבה חדשה נוספה לקבוצה:\n${ev.description}\nתאריך: ${ev.date}\nשעת מפגש: ${ev.meetTime || '06:00'}\nנקודת מפגש: ${ev.meetPoint || '—'}\nמרחק: ${ev.km} ק"מ | עלייה: ${ev.climb} מ'\n\nהיכנס לאפליקציה להרשמה.\n\n${clubName}`;
    const html    = wrap(`
      <h1>🚴 רכיבה חדשה!</h1>
      <p>שלום <strong>${esc(r.name)}</strong>, נוספה רכיבה חדשה לקבוצה:</p>
      ${evBox(ev)}
      <p>היכנס לאפליקציה להרשמה לרכיבה!</p>
    `, clubName);
    return { from, to: r.email, subject, text, html };
  });
}

// deno-lint-ignore no-explicit-any
function buildSmtpTest(p: any, from: string, clubName: string): Mail {
  const subject = '✅ בדיקת חיבור SMTP — קבוצת האופניים';
  const text    = `שלום ${p.name || ''},\n\nחיבור ה-SMTP פועל תקין!\nהגדרות שליחת המיילים של קבוצת האופניים מוגדרות בהצלחה.\n\n${clubName}`;
  const html    = wrap(`
    <h1>✅ חיבור SMTP תקין!</h1>
    <p>שלום <strong>${esc(p.name || '')}</strong>,</p>
    <p>מייל הבדיקה התקבל בהצלחה.<br>הגדרות שליחת המיילים פועלות כראוי.</p>
  `, clubName);
  return { from, to: p.to, subject, text, html };
}

// deno-lint-ignore no-explicit-any
function buildBirthday(p: any, from: string, clubName: string): Mail[] {
  // deno-lint-ignore no-explicit-any
  return (p.riders as any[]).map(r => {
    const subject = `🎂 יום הולדת שמח, ${r.name}!`;
    const text    = `שלום ${r.name},\n\nכל חברי קבוצת האופניים מאחלים לך יום הולדת שמח! 🚴🎉\nשנה טובה, בריאות, וכמה שיותר רכיבות מדהימות!\n\n${clubName}`;
    const html    = wrap(`
      <h1>🎂 יום הולדת שמח!</h1>
      <p>שלום <strong>${esc(r.name)}</strong>,</p>
      <p>כל חברי קבוצת האופניים מאחלים לך <strong>יום הולדת שמח</strong>! 🎉</p>
      <p>שנה טובה, בריאות, וכמה שיותר רכיבות מדהימות! 🚴</p>
    `, clubName);
    return { from, to: r.email, subject, text, html };
  });
}

// deno-lint-ignore no-explicit-any
function evBox(ev: any): string {
  return `<div class="box">
    <div class="row"><span class="lbl">מסלול</span><strong>${esc(ev.description)}</strong></div>
    <div class="row"><span class="lbl">תאריך</span>${esc(ev.date)}</div>
    <div class="row"><span class="lbl">שעת מפגש</span>${esc(ev.meetTime || '06:00')}</div>
    <div class="row"><span class="lbl">נקודת מפגש</span>${esc(ev.meetPoint || '—')}</div>
    <div class="row"><span class="lbl">מרחק</span>${esc(ev.km)} ק"מ | ${esc(ev.climb)} מ' עלייה</div>
    ${ev.captain ? `<div class="row"><span class="lbl">קפטן</span>${esc(ev.captain)}</div>` : ''}
  </div>`;
}
