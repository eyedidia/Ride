// ═══════════════════════════════════════════════════════════════
// Supabase Edge Function: exam-reminders
// תפקיד: cron יומי — שולח תזכורות לרוכבים עם בדיקה פוגת תוקף
//
// הפעלה (Supabase Dashboard → Edge Functions → Schedules):
//   Cron: "0 8 * * *"  (מדי יום בשעה 08:00)
//
// משתני סביבה:
//   SUPABASE_URL              (אוטומטי)
//   SUPABASE_SERVICE_ROLE_KEY (אוטומטי)
//   ADMIN_DAYS  (אופציונלי, ברירת מחדל: "30,14,7")
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const _sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const DAYS = (Deno.env.get('ADMIN_DAYS') ?? '30,14,7')
  .split(',').map(d => parseInt(d.trim())).filter(d => d > 0);

Deno.serve(async (_req) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // חשב את התאריכים הרלוונטיים
    const targets = DAYS.map(d => {
      const t = new Date(today);
      t.setDate(t.getDate() + d);
      return t.toISOString().slice(0, 10);
    });

    // שלוף רוכבים שהבדיקה שלהם פוגת בתאריכים הנ"ל
    const { data: expiring, error } = await _sb
      .from('riders_view')
      .select('name, email, exam_expiry')
      .in('exam_expiry', targets);

    if (error) throw error;
    if (!expiring?.length) {
      return ok({ sent: false, reason: 'אין בדיקות פוגות' });
    }

    // שלוף מנהלים עם מייל
    const { data: admins } = await _sb
      .from('riders')
      .select('email')
      .eq('permission', 'מנהל')
      .neq('email', '');
    const adminEmails = (admins || []).map((a: { email: string }) => a.email).filter(Boolean);

    // חלק לרוכבים עם/בלי מייל
    const withEmail = expiring.filter((r: { email: string }) => r.email?.trim());
    const noEmail   = expiring.filter((r: { email: string }) => !r.email?.trim());

    let sentCount = 0;

    // שלח תזכורות אישיות לרוכבים עם מייל
    if (withEmail.length) {
      const recipients = withEmail.map((r: { name: string; email: string; exam_expiry: string }) => {
        const expiry   = new Date(r.exam_expiry);
        const daysLeft = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
        return { name: r.name, email: r.email, daysLeft };
      });

      const { data, error: fnErr } = await _sb.functions.invoke('notify', {
        body: { type: 'exam_reminder', payload: { recipients, adminEmails } },
      });
      if (fnErr) throw fnErr;
      sentCount = (data as { sent?: number })?.sent ?? withEmail.length;
    }

    // הודע למנהלים על רוכבים ללא מייל
    if (noEmail.length && adminEmails.length) {
      const riders = noEmail.map((r: { name: string; exam_expiry: string }) => {
        const expiry   = new Date(r.exam_expiry);
        const daysLeft = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
        return { name: r.name, daysLeft };
      });

      const { error: fnErr } = await _sb.functions.invoke('notify', {
        body: { type: 'exam_no_email', payload: { adminEmails, riders } },
      });
      if (fnErr) throw fnErr;
    }

    // ─── יום הולדת ───────────────────────────────────────────────
    const todayMM = String(today.getMonth() + 1).padStart(2, '0');
    const todayDD = String(today.getDate()).padStart(2, '0');

    const { data: allRiders } = await _sb
      .from('riders')
      .select('name, email, dob')
      .neq('email', '');

    const birthdayRiders = (allRiders || []).filter((r: { dob: string }) => {
      if (!r.dob) return false;
      const parts = r.dob.split('-'); // YYYY-MM-DD
      return parts[1] === todayMM && parts[2] === todayDD;
    });

    if (birthdayRiders.length) {
      await _sb.functions.invoke('notify', {
        body: {
          type: 'birthday',
          payload: { riders: birthdayRiders.map((r: { name: string; email: string }) => ({ name: r.name, email: r.email })) },
        },
      });
    }

    // ─── WhatsApp תזכורת יום לפני אירוע ─────────────────────────
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const { data: tomorrowEvs } = await _sb
      .from('events')
      .select('description, meet_time, meet_point, km, climb')
      .eq('date', tomorrowStr)
      .eq('status', 'פעיל');

    let waSent = 0;
    if (tomorrowEvs?.length) {
      const { data: wa } = await _sb
        .from('whatsapp_settings').select('*').eq('id', 1).single();
      if (wa?.instance_id && wa?.token && wa?.group_chat_id && wa?.enabled) {
        for (const ev of tomorrowEvs as { description: string; meet_time: string; meet_point: string; km: number; climb: number }[]) {
          const msg = `⏰ תזכורת רכיבה מחר!\n🚴 ${ev.description}\n⏰ ${ev.meet_time || '06:00'}\n📍 ${ev.meet_point || ''}\n🛣️ ${ev.km} ק"מ | ⛰️ ${ev.climb} מ'`;
          const res = await fetch(
            `https://api.green-api.com/waInstance${wa.instance_id}/sendMessage/${wa.token}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chatId: wa.group_chat_id, message: msg }) }
          ).catch(() => null);
          if (res?.ok) waSent++;
        }
      }
    }

    return ok({ processed: expiring.length, withEmail: withEmail.length, noEmail: noEmail.length, sent: sentCount, birthdaysSent: birthdayRiders.length, waTomorrowReminders: waSent });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
