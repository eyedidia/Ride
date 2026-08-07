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

    // ─── WhatsApp group message (Green API) — handled before SMTP ───
    if (type === 'whatsapp_group') {
      const { data: wa } = await _sb
        .from('whatsapp_settings').select('*').eq('id', 1).single();
      if (!wa?.instance_id || !wa?.token || !wa?.group_chat_id || !wa?.enabled) {
        console.warn('[notify] WhatsApp not configured or disabled');
        return json({ skipped: 'WhatsApp לא מוגדר או מושבת' });
      }
      const res = await fetch(
        `https://api.green-api.com/waInstance${wa.instance_id}/sendMessage/${wa.token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: wa.group_chat_id, message: payload.message }),
        }
      );
      const body = await res.text();
      if (!res.ok) {
        console.error('[notify] Green API error:', res.status, body);
        return json({ error: `Green API: ${res.status} ${body}` }, 500);
      }
      console.log('[notify] WhatsApp sent:', body);
      return json({ sent: 1 });
    }

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

    // RFC 2047 — קודד שם תצוגה non-ASCII ב-From header (נדרש ע"י Yahoo/Gmail)
    function encodeFromHeader(from: string): string {
      const m = from.match(/^(.+?)\s*<([^>]+)>$/);
      if (!m) return from;
      const [, name, addr] = m;
      return /[^\x00-\x7F]/.test(name)
        ? `${encodeSubject(name.trim())} <${addr}>`
        : from;
    }

    const headers = [
      'MIME-Version: 1.0',
      `Date: ${new Date().toUTCString()}`,
      `From: ${encodeFromHeader(mail.from)}`,
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
</head>
<body dir="rtl" style="font-family:Arial,sans-serif;direction:rtl;text-align:right;background:#f5f5f5;margin:0;padding:20px">
<div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:520px;margin:0 auto;box-shadow:0 2px 8px rgba(0,0,0,.08);direction:rtl;text-align:right">
  <div style="font-size:1.1rem;font-weight:800;color:#4f7cff;margin-bottom:20px">🚴 ${esc(clubName)}</div>
  ${content}
  <div style="color:#aaa;font-size:.75rem;margin-top:24px;border-top:1px solid #eee;padding-top:12px">הודעה זו נשלחה ממערכת ניהול קבוצת האופניים. אין להשיב למייל זה.</div>
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
      <h1 style="font-size:1.15rem;margin:0 0 16px;color:#111">${urgent} תזכורת: בדיקה ארגומטרית</h1>
      <p style="color:#444;line-height:1.6;margin:0 0 12px">שלום <strong>${esc(r.name)}</strong>,</p>
      <p style="color:#444;line-height:1.6;margin:0 0 12px">הבדיקה הארגומטרית שלך פוגת תוקף בעוד <strong>${esc(r.daysLeft)} ימים</strong>.</p>
      <p style="color:#444;line-height:1.6;margin:0 0 12px">אנא קבע תור לבדיקה בהקדם כדי להמשיך להשתתף בפעילויות הקבוצה.</p>
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
  const htmlRows = (p.riders as any[]).map((r: any) => `<div style="margin-bottom:6px;font-size:.9rem">• <strong>${esc(r.name)}</strong> — ${esc(r.daysLeft)} ימים</div>`).join('');
  const subject  = `ℹ️ ${p.riders.length} רוכבים ללא כתובת מייל לתזכורת בדיקה`;
  const text     = `שלום,\n\nהרוכבים הבאים זקוקים לתזכורת בדיקה ארגומטרית אך אין להם כתובת מייל:\n\n${lines}\n\nאנא צור איתם קשר ישירות.\n\n${clubName}`;
  const html     = wrap(`
    <h1 style="font-size:1.15rem;margin:0 0 16px;color:#111">ℹ️ רוכבים ללא כתובת מייל</h1>
    <p style="color:#444;line-height:1.6;margin:0 0 12px">הרוכבים הבאים זקוקים לתזכורת בדיקה ארגומטרית, אך <strong>אין להם כתובת מייל</strong> במערכת:</p>
    <div style="background:#f8f9ff;border-radius:8px;padding:14px 16px;margin:16px 0;direction:rtl;text-align:right">${htmlRows}</div>
    <p style="color:#444;line-height:1.6;margin:0 0 12px">אנא צור איתם קשר ישירות.</p>
  `, clubName);
  return { from, to: p.adminEmails, subject, text, html };
}

// deno-lint-ignore no-explicit-any
function buildEventRegistered(p: any, from: string, clubName: string): Mail {
  const ev = p.event;
  const subject = `✅ נרשמת לרכיבה: ${ev.description}`;
  const text    = `שלום ${p.name},\n\nנרשמת בהצלחה לרכיבה:\n${ev.description}\nתאריך: ${ev.date}\nשעת מפגש: ${ev.meetTime || '06:00'}\nנקודת מפגש: ${ev.meetPoint || '—'}\nמרחק: ${ev.km} ק"מ | עלייה: ${ev.climb} מ'\n\n${clubName}`;
  const html    = wrap(`
    <h1 style="font-size:1.15rem;margin:0 0 16px;color:#111">✅ נרשמת לרכיבה!</h1>
    <p style="color:#444;line-height:1.6;margin:0 0 12px">שלום <strong>${esc(p.name)}</strong>, נרשמת בהצלחה לרכיבה הבאה:</p>
    ${evBox(ev)}
    <p style="color:#444;line-height:1.6;margin:0 0 12px">נתראה ברכיבה! 🚴</p>
  `, clubName);
  return { from, to: p.email, subject, text, html };
}

// deno-lint-ignore no-explicit-any
function buildEventRegByAdmin(p: any, from: string, clubName: string): Mail {
  const ev = p.event;
  const subject = `✅ נרשמת לרכיבה: ${ev.description}`;
  const text    = `שלום ${p.name},\n\nהמנהל ${p.registeredBy} רשם אותך לרכיבה:\n${ev.description}\nתאריך: ${ev.date}\nשעת מפגש: ${ev.meetTime || '06:00'}\nנקודת מפגש: ${ev.meetPoint || '—'}\n\n${clubName}`;
  const html    = wrap(`
    <h1 style="font-size:1.15rem;margin:0 0 16px;color:#111">✅ נרשמת לרכיבה!</h1>
    <p style="color:#444;line-height:1.6;margin:0 0 12px">שלום <strong>${esc(p.name)}</strong>,<br>המנהל <strong>${esc(p.registeredBy)}</strong> רשם אותך לרכיבה הבאה:</p>
    ${evBox(ev)}
    <p style="color:#444;line-height:1.6;margin:0 0 12px">נתראה ברכיבה! 🚴</p>
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
      <h1 style="font-size:1.15rem;margin:0 0 16px;color:#111">❌ הרכיבה בוטלה</h1>
      <p style="color:#444;line-height:1.6;margin:0 0 12px">שלום <strong>${esc(r.name)}</strong>,</p>
      <p style="color:#444;line-height:1.6;margin:0 0 12px">לצערנו הרכיבה <strong>"${esc(ev.description)}"</strong> שתוכננה לתאריך <strong>${esc(ev.date)}</strong> בוטלה.</p>
      <p style="color:#444;line-height:1.6;margin:0 0 12px">נתראה ברכיבה הבאה! 🚴</p>
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
    const text    = `שלום ${r.name},\n\nרכיבה חדשה נוספה לקבוצה:\n${ev.description}\nתאריך: ${ev.date}\nשעת מפגש: ${ev.meetTime || '06:00'}\nנקודת מפגש: ${ev.meetPoint || '—'}\nמרחק: ${ev.km} ק"מ | עלייה: ${ev.climb} מ'\n\nהיכנס לאפליקציה להרשמה לרכיבה: https://eyedidia.github.io/Ride/rider.html\n\n${clubName}`;
    const html    = wrap(`
      <h1 style="font-size:1.15rem;margin:0 0 16px;color:#111">🚴 רכיבה חדשה!</h1>
      <p style="color:#444;line-height:1.6;margin:0 0 12px">שלום <strong>${esc(r.name)}</strong>, נוספה רכיבה חדשה לקבוצה:</p>
      ${evBox(ev)}
      <p style="color:#444;line-height:1.6;margin:0 0 12px">
      <a href="https://eyedidia.github.io/Ride/rider.html" style="color:#4f7cff;font-weight:700;" target="_blank" rel="noopener noreferrer">היכנס לאפליקציה להרשמה לרכיבה!
      </a>
      </p>
    `, clubName);
    return { from, to: r.email, subject, text, html };
  });
}

// deno-lint-ignore no-explicit-any
function buildSmtpTest(p: any, from: string, clubName: string): Mail {
  const subject = '✅ בדיקת חיבור SMTP — קבוצת האופניים';
  const text    = `שלום ${p.name || ''},\n\nחיבור ה-SMTP פועל תקין!\nהגדרות שליחת המיילים של קבוצת האופניים מוגדרות בהצלחה.\n\n${clubName}`;
  const html    = wrap(`
    <h1 style="font-size:1.15rem;margin:0 0 16px;color:#111">✅ חיבור SMTP תקין!</h1>
    <p style="color:#444;line-height:1.6;margin:0 0 12px">שלום <strong>${esc(p.name || '')}</strong>,</p>
    <p style="color:#444;line-height:1.6;margin:0 0 12px">מייל הבדיקה התקבל בהצלחה.<br>הגדרות שליחת המיילים פועלות כראוי.</p>
    <p style="color:#444;line-height:1.6;margin:0 0 12px">
      <a href="https://eyedidia.github.io/Ride/rider.html" style="color:#4f7cff;font-weight:700;" target="_blank" rel="noopener noreferrer">היכנס לאפליקציה להרשמה לרכיבה!
    </a>
    </p>
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
      <h1 style="font-size:1.15rem;margin:0 0 16px;color:#111">🎂 יום הולדת שמח!</h1>
      <p style="color:#444;line-height:1.6;margin:0 0 12px">שלום <strong>${esc(r.name)}</strong>,</p>
      <p style="color:#444;line-height:1.6;margin:0 0 12px">כל חברי קבוצת האופניים מאחלים לך <strong>יום הולדת שמח</strong>! 🎉</p>
      <p style="color:#444;line-height:1.6;margin:0 0 12px">שנה טובה, בריאות, וכמה שיותר רכיבות מדהימות! 🚴</p>
    `, clubName);
    return { from, to: r.email, subject, text, html };
  });
}

// deno-lint-ignore no-explicit-any
function evBox(ev: any): string {
  return `<div style="background:#f8f9ff;border-radius:8px;padding:14px 16px;margin:16px 0;direction:rtl;text-align:right">
    <div style="margin-bottom:6px;font-size:.9rem"><span style="color:#888;font-size:.78rem;display:block">מסלול</span><strong>${esc(ev.description)}</strong></div>
    <div style="margin-bottom:6px;font-size:.9rem"><span style="color:#888;font-size:.78rem;display:block">תאריך</span>${esc(ev.date)}</div>
    <div style="margin-bottom:6px;font-size:.9rem"><span style="color:#888;font-size:.78rem;display:block">שעת מפגש</span>${esc(ev.meetTime || '06:00')}</div>
    <div style="margin-bottom:6px;font-size:.9rem"><span style="color:#888;font-size:.78rem;display:block">נקודת מפגש</span>${esc(ev.meetPoint || '—')}</div>
    <div style="margin-bottom:6px;font-size:.9rem"><span style="color:#888;font-size:.78rem;display:block">מרחק</span>${esc(ev.km)} ק"מ | ${esc(ev.climb)} מ' עלייה</div>
    ${ev.captain ? `<div style="margin-bottom:6px;font-size:.9rem"><span style="color:#888;font-size:.78rem;display:block">קפטן</span>${esc(ev.captain)}</div>` : ''}
  </div>`;
}
