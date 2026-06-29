// ═══════════════════════════════════════════════════════════════
// Supabase Client — מחליף את API_URL + apiGet/callAPI
// טען קובץ זה אחרי CDN של Supabase ולפני admin-common.js
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL      = 'https://gritbcrdxpeycnxrlulp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyaXRiY3JkeHBleWNueHJsdWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI1NzgsImV4cCI6MjA5MzkxODU3OH0.PRk_DQeHF4vGy-0qZH2XFIUOoOQ_cekPOW_gWdmHXXc';

if (!window.supabase) {
  const _cdnErr = () => Promise.reject(new Error('שגיאת חיבור: ספריית Supabase לא נטענה. בדוק חיבור לאינטרנט ורענן את הדף.'));
  window.apiGet = window.callAPI = _cdnErr;
  throw new Error('Supabase CDN missing');
}
const _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─────────────────────────────────────────────
// נרמול טלפון ישראלי (מקביל ל-GAS normalizePhone)
// ─────────────────────────────────────────────
function normalizePhone(phone) {
  let p = phone.toString().replace(/[\s\-\(\)]/g, '');
  if (p.startsWith('+972'))  p = '0' + p.slice(4);
  if (p.startsWith('972'))   p = '0' + p.slice(3);
  if (!p.startsWith('0'))    p = '0' + p;
  return p;
}

function _getCallerTid() {
  try {
    const u = JSON.parse(sessionStorage.getItem('user') || '{}');
    return u.tid || '';
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────
// apiGet & callAPI
// ─────────────────────────────────────────────

async function apiGet(action, params = {}) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 20000);
  try {
    if (action === 'getEvents') {
      const { data, error } = await _sb.rpc('get_events');
      if (error) throw error;
      return data;
    }
    if (action === 'getAllEvents') {
      const { data, error } = await _sb.rpc('get_all_events');
      if (error) throw error;
      return data;
    }
    if (action === 'getRegistrations') {
      const { eventId } = params;
      const { data, error } = await _sb.rpc('get_registrations', { p_event_id: eventId });
      if (error) throw error;
      return data;
    }
    if (action === 'getEventCounts') {
      const { data, error } = await _sb.rpc('get_event_counts');
      if (error) throw error;
      return data;
    }
    if (action === 'getBikes') {
      const { data, error } = await _sb
        .from('bikes')
        .select('id,name,frame,drive,status')
        .order('name');
      if (error) throw error;
      return data;
    }
    if (action === 'getRideHistory') {
      const p_tid = params.tid || params.stokerTid;
      if (!p_tid) return [];
      const { data, error } = await _sb.rpc('get_ride_history', { p_tid });
      if (error) throw error;
      return data;
    }
    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('הקישור לשרת עלה על הזמן המוקצב. נסה שוב.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callAPI(action, body = {}) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 20000);
  try {
    // login
    if (action === 'login') {
      const { phone, name } = body;
      const { data, error } = await _sb.rpc('login', {
        p_phone: normalizePhone(phone),
        p_name: name
      });
      if (error) throw new Error(error.message || 'פרטי הכניסה שגויים');
      return data;
    }

    // register
    if (action === 'register') {
      const { tid, eventId, role } = body;
      const { data, error } = await _sb.rpc('register_to_event', {
        p_tid: tid,
        p_event_id: eventId,
        p_role: role || ''
      });
      if (error) throw new Error(error.message);
      return data;
    }

    // cancelRegistration
    if (action === 'cancelRegistration') {
      const { tid, eventId } = body;
      const { data, error } = await _sb.rpc('cancel_registration', {
        p_tid: tid,
        p_event_id: eventId
      });
      if (error) throw new Error(error.message);
      return data;
    }

    // updateMyProfile
    if (action === 'updateMyProfile') {
      const tid = _getCallerTid();
      const { phone, email, city, gender, dob } = body;
      const { data, error } = await _sb.rpc('update_my_profile', {
        p_tid: tid,
        p_phone: phone ? normalizePhone(phone) : null,
        p_email: email || null,
        p_city: city || null,
        p_gender: gender || null,
        p_dob: dob ? dob.split('/').reverse().join('-') : null
      });
      if (error) throw new Error(error.message);
      return data;
    }

    // admin actions
    if (action === 'assignBike') {
      const { eventId, tid, bikeId } = body;
      const { data, error } = await _sb.rpc('assign_bike', {
        p_caller_tid: _getCallerTid(),
        p_event_id: eventId,
        p_tid: tid,
        p_bike_id: bikeId
      });
      if (error) throw new Error(error.message);
      return data;
    }

    if (action === 'assignPartner') {
      const { eventId, captainTid, stokerTid } = body;
      const { data, error } = await _sb.rpc('assign_partner', {
        p_caller_tid: _getCallerTid(),
        p_event_id: eventId,
        p_captain_tid: captainTid,
        p_stoker_tid: stokerTid
      });
      if (error) throw new Error(error.message);
      return data;
    }

    if (action === 'unassignPartner') {
      const { eventId, captainTid, stokerTid } = body;
      const { data, error } = await _sb.rpc('unassign_partner', {
        p_caller_tid: _getCallerTid(),
        p_event_id: eventId,
        p_captain_tid: captainTid,
        p_stoker_tid: stokerTid
      });
      if (error) throw new Error(error.message);
      return data;
    }

    if (action === 'sendEmail') {
      const { type, payload } = body;
      const { data, error } = await _sb.functions.invoke('notify', {
        body: { type, payload }
      });
      if (error) throw new Error(error.message);
      return data;
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('הקישור לשרת עלה על הזמן המוקצב. נסה שוב.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
