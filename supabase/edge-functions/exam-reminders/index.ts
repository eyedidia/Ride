// ═══════════════════════════════════════════════════════════════
// Supabase Edge Function: exam-reminders
// תפקיד: שולח מייל למנהל 30 יום לפני פקיעת בדיקה ארגומטרית
//
// הפעלה: הגדר cron trigger בדשבורד:
//   Schedule → New Schedule → "0 8 * * *" → exec exam-reminders
//
// משתני סביבה נדרשים (Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL        - URL הפרויקט
//   SUPABASE_SERVICE_ROLE_KEY - service role key (לקריאה ישירה)
//   ADMIN_EMAIL         - כתובת מייל של המנהל
//   RESEND_API_KEY      - מפתח Resend (https://resend.com) לשליחת מייל
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_EMAIL             = Deno.env.get('ADMIN_EMAIL') ?? 'eyedidia@gmail.com';
const RESEND_API_KEY          = Deno.env.get('RESEND_API_KEY')!;

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const target = new Date();
    target.setDate(target.getDate() + 30);
    const targetStr = target.toISOString().slice(0, 10); // YYYY-MM-DD

    const { data: expiring, error } = await supabase
      .from('riders_view')
      .select('name, exam_expiry')
      .eq('exam_expiry', targetStr);

    if (error) throw error;
    if (!expiring || expiring.length === 0) {
      return new Response(JSON.stringify({ sent: false, reason: 'no expiring exams' }), { status: 200 });
    }

    const lines = expiring.map((r: { name: string; exam_expiry: string }) =>
      `• ${r.name} — תוקף פג בתאריך ${r.exam_expiry}`
    ).join('\n');

    const body = `שלום,\n\nהבדיקה הארגומטרית של הרוכבים הבאים פוגת תוקף בעוד 30 יום:\n\n${lines}\n\nאנא עדכן את המועדים בהקדם.\n\nמערכת ניהול קבוצת האופניים`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ride@yourdomain.com',
        to: ADMIN_EMAIL,
        subject: `⚠️ ${expiring.length} רוכב/ים עם בדיקה שפוגת תוקף בעוד 30 יום`,
        text: body,
      }),
    });

    if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);

    return new Response(JSON.stringify({ sent: true, count: expiring.length }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
