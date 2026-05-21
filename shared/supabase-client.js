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
  if (p.startsWith('+972')) p = '0' + p.slice(4);
  else if (p.startsWith('972')) p = '0' + p.slice(3);
  if (!p.startsWith('0')) p = '0' + p;
  return p;
}

// ─────────────────────────────────────────────
// קריאת tid של המשתמש המחובר מה-sessionStorage
// ─────────────────────────────────────────────
function _getCallerTid() {
  try {
    return (JSON.parse(sessionStorage.getItem('user') || '{}')).tid || '';
  } catch { return ''; }
}

// ─────────────────────────────────────────────
// ROUTER — מיפוי action → Supabase
// ─────────────────────────────────────────────

async function _route(action, data) {

  // ── REST ישיר (קריאה בלבד) ───────────────────────────────────

  if (action === 'getAllRiders') {
    const { data: d, error } = await _sb.from('riders_view').select('*');
    if (error) throw error;
    // המרת עמודות snake_case לcamelCase שהפרונטאנד מצפה לו
    return (d || []).map(r => ({
      tid: r.tid, name: r.name, phone: r.phone, email: r.email,
      city: r.city, age: r.age?.toString() ?? '', gender: r.gender,
      permission: r.permission, rideStyle: r.ride_style,
      dob: r.dob ? _fmtDate(r.dob) : '',
      examDate: r.exam_date ? _fmtDate(r.exam_date) : '',
      examExpiry: r.exam_expiry ? _fmtDate(r.exam_expiry) : '',
      examStatus: r.exam_status ?? 'אין בדיקה',
    })).sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }

  if (action === 'getBikes') {
    const { data: d, error } = await _sb.from('bikes').select('*');
    if (error) throw error;
    return d || [];
  }

  if (action === 'getMaintenance') {
    let q = _sb.from('maintenance').select('*');
    if (data.bikeId) q = q.eq('bike_id', data.bikeId);
    const { data: d, error } = await q.order('date_in', { ascending: false });
    if (error) throw error;
    return (d || []).map(m => ({
      id: m.id, bikeId: m.bike_id, bikeName: m.bike_name,
      fault: m.fault,
      dateIn:  m.date_in  ? _fmtDate(m.date_in)  : '',
      dateOut: m.date_out ? _fmtDate(m.date_out) : '',
      status: m.status,
    }));
  }

  if (action === 'getPhoneBook') {
    const { data: d, error } = await _sb.from('riders').select('name,phone,city').order('name');
    if (error) throw error;
    return d || [];
  }

  if (action === 'getTodayBirthdays') {
    const { data: d, error } = await _sb.from('riders').select('name,phone,dob');
    if (error) throw error;
    const now = new Date();
    const mm = now.getMonth() + 1;
    const dd = now.getDate();
    return (d || []).filter(r => {
      if (!r.dob) return false;
      const parts = r.dob.split('-');   // YYYY-MM-DD
      return parseInt(parts[1]) === mm && parseInt(parts[2]) === dd;
    }).map(r => ({ name: r.name, phone: r.phone }));
  }

  if (action === 'updateRider') {
    const { tid, name, phone, email, city, rideStyle, permission } = data;
    const { data: d, error } = await _sb.rpc('update_rider', {
      p_caller_tid: _getCallerTid(),
      p_tid:        tid,
      p_name:       name,
      p_phone:      phone,
      p_email:      email      || '',
      p_city:       city       || '',
      p_ride_style: rideStyle  || 'סינגל',
      p_permission: permission || 'משתמש',
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'deleteRider') {
    const { data: d, error } = await _sb.rpc('delete_rider', {
      p_caller_tid: _getCallerTid(),
      p_tid:        data.tid,
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'updateBike') {
    const { bikeId, name, frame, drive } = data;
    const { data: d, error } = await _sb.rpc('update_bike', {
      p_caller_tid: _getCallerTid(),
      p_bike_id:    bikeId,
      p_name:       name,
      p_frame:      frame || '',
      p_drive:      drive || '',
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'deleteBike') {
    const { data: d, error } = await _sb.rpc('delete_bike', {
      p_caller_tid: _getCallerTid(),
      p_bike_id:    data.bikeId,
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'assignBike') {
    const { tid, eventId, bikeId } = data;
    const { data: d, error } = await _sb.rpc('assign_bike', {
      p_caller_tid: _getCallerTid(),
      p_event_id:   eventId,
      p_tid:        tid,
      p_bike_id:    bikeId,
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'cancelEvent') {
    const { data: d, error } = await _sb.rpc('cancel_event', {
      p_caller_tid: _getCallerTid(),
      p_event_id:   data.eventId,
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'updateExamDate') {
    const { data: d, error } = await _sb.rpc('update_exam_date', {
      p_caller_tid: _getCallerTid(),
      p_tid:        data.tid,
      p_exam_date:  data.examDate,
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'updateMyProfile') {
    const { tid, phone, city, email, gender, dob } = data;
    const { data: d, error } = await _sb.rpc('update_my_profile', {
      p_tid:    tid,
      p_phone:  phone  !== undefined ? phone  : null,
      p_city:   city   !== undefined ? city   : null,
      p_email:  email  !== undefined ? email  : null,
      p_gender: gender !== undefined ? gender : null,
      p_dob:    dob    !== undefined ? dob    : null,
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'cancelRegistration') {
    const { data: d, error } = await _sb.rpc('cancel_registration', {
      p_tid:      data.tid,
      p_event_id: data.eventId,
    });
    if (error) throw error;
    return d || { success: true };
  }

  // ── RPC פשוטה ────────────────────────────────────────────────

  if (action === 'getEvents') {
    const { data: d, error } = await _sb.rpc('get_events');
    if (error) throw error;
    return d || [];
  }

  if (action === 'getAllEvents') {
    const { data: d, error } = await _sb.rpc('get_all_events');
    if (error) throw error;
    return d || { upcoming: [], past: [], cancelled: [] };
  }

  if (action === 'getRegistrations') {
    const { data: d, error } = await _sb.rpc('get_registrations', { p_event_id: data.eventId });
    if (error) throw error;
    return d || [];
  }

  if (action === 'getMyRegistrations') {
    // Returns event_ids where tid is registered — single query instead of N per-event calls
    const { data: d, error } = await _sb.from('registrations').select('event_id').eq('tid', data.tid);
    if (error) throw error;
    return (d || []).map(r => r.event_id);
  }

  if (action === 'getEventCounts') {
    const { data: d, error } = await _sb.rpc('get_event_counts');
    if (error) throw error;
    return d || {};
  }

  if (action === 'getRideHistory') {
    const p_tid = data.tid || data.stokerTid;
    if (!p_tid) return [];
    const { data: d, error } = await _sb.rpc('get_ride_history', { p_tid });
    if (error) throw error;
    return d || [];
  }

  if (action === 'updateEvent') {
    const { eventId, date, description, km, climb, meetPoint, meetTime, captain } = data;
    const { data: d, error } = await _sb.rpc('update_event', {
      p_caller_tid:  _getCallerTid(),
      p_event_id:    eventId,
      p_date:        date,
      p_description: description,
      p_km:          km || 0,
      p_climb:       climb || 0,
      p_meet_point:  meetPoint || '',
      p_meet_time:   meetTime  || '06:00',
      p_captain:     captain   || '',
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'updateEventActual') {
    const { error } = await _sb.rpc('update_event_actual', {
      p_caller_tid:         _getCallerTid(),
      p_event_id:           data.eventId,
      p_actual_km:          data.actualKm          ?? null,
      p_actual_climb:       data.actualClimb        ?? null,
      p_actual_description: data.actualDescription  || null,
      p_attended_tids:      data.attendedTids,
    });
    if (error) throw error;
    return { success: true };
  }

  // ── RPC עם טרנזקציה ──────────────────────────────────────────

  if (action === 'login') {
    const { data: d, error } = await _sb.rpc('login', {
      p_phone: normalizePhone(data.phone),
      p_name:  data.name,
    });
    if (error) throw error;
    return d;
  }

  if (action === 'register') {
    const { data: d, error } = await _sb.rpc('register_to_event', {
      p_tid:      data.tid,
      p_event_id: data.eventId,
      p_role:     data.role     || '',
      p_bike_id:  data.bikeId   || '',
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'assignPartner') {
    const { data: d, error } = await _sb.rpc('assign_partner', {
      p_caller_tid:  _getCallerTid(),
      p_event_id:    data.eventId,
      p_captain_tid: data.captainTid,
      p_stoker_tid:  data.stokerTid || null,
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'unassignPartner') {
    const { data: d, error } = await _sb.rpc('unassign_partner', {
      p_caller_tid:  _getCallerTid(),
      p_event_id:    data.eventId,
      p_captain_tid: data.captainTid,
      p_stoker_tid:  data.stokerTid || null,
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'disableBike') {
    const { data: d, error } = await _sb.rpc('disable_bike', {
      p_caller_tid: _getCallerTid(),
      p_bike_id:    data.bikeId,
      p_fault:      data.fault || 'לא צוין',
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'enableBike') {
    const { data: d, error } = await _sb.rpc('enable_bike', {
      p_caller_tid: _getCallerTid(),
      p_bike_id:    data.bikeId,
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'addRider') {
    const { data: d, error } = await _sb.rpc('add_rider', {
      p_caller_tid: _getCallerTid(),
      p_tid:        data.tid,
      p_name:       data.name,
      p_phone:      data.phone,
      p_email:      data.email      || '',
      p_city:       data.city       || '',
      p_dob:        data.dob        || null,
      p_gender:     data.gender     || '',
      p_permission: data.permission || 'משתמש',
      p_ride_style: data.rideStyle  || 'סינגל',
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'addEvent') {
    const { data: d, error } = await _sb.rpc('add_event', {
      p_caller_tid:  _getCallerTid(),
      p_date:        data.date,
      p_description: data.description,
      p_km:          data.km          || 0,
      p_climb:       data.climb       || 0,
      p_meet_point:  data.meetPoint   || '',
      p_meet_time:   data.meetTime    || '06:00',
      p_captain:     data.captain     || '',
      p_status:      data.status      || 'פעיל',
    });
    if (error) throw error;
    return d || { success: true };
  }

  if (action === 'addBike') {
    const { data: d, error } = await _sb.rpc('add_bike', {
      p_caller_tid: _getCallerTid(),
      p_name:       data.name,
      p_frame:      data.frame  || '',
      p_drive:      data.drive  || '',
      p_status:     data.status || 'תקין',
    });
    if (error) throw error;
    return d || { success: true };
  }

  // ── מיילים — Edge Function notify ───────────────────────────

  if (action === 'sendExamReminders') {
    const { error } = await _sb.functions.invoke('notify', {
      body: { type: 'exam_reminder', payload: data },
    });
    if (error) throw error;
    return { success: true };
  }

  if (action === 'notifyAdminNoEmail') {
    const { error } = await _sb.functions.invoke('notify', {
      body: { type: 'exam_no_email', payload: data },
    });
    if (error) throw error;
    return { success: true };
  }

  if (action === 'sendEmail') {
    const { error } = await _sb.functions.invoke('notify', {
      body: { type: data.type, payload: data.payload },
    });
    if (error) throw error;
    return { success: true };
  }

  // ── הגדרות SMTP ──────────────────────────────────────────────

  if (action === 'getSmtpSettings') {
    const { data: rows, error } = await _sb.rpc('get_smtp_settings', { p_code: data.code });
    if (error) throw error;
    return rows?.[0] ?? null;
  }

  if (action === 'saveSmtpSettings') {
    const { error } = await _sb.rpc('save_smtp_settings', {
      p_code:      data.code,
      p_host:      data.host,
      p_port:      data.port,
      p_secure:    data.secure,
      p_user:      data.user,
      p_pass:      data.pass,
      p_from_name: data.fromName,
    });
    if (error) throw error;
    return { success: true };
  }

  throw new Error('פעולה לא מוכרת: ' + action);
}

// ─────────────────────────────────────────────
// ממשק ציבורי — חתימות זהות לקוד הקיים
// זורקים שגיאה במקרה של כישלון (כמו הקוד המקורי)
// ─────────────────────────────────────────────

async function apiGet(action, params = {}, _retry) {
  return _route(action, params);
}

async function callAPI(action, body = {}, _retry) {
  return _route(action, body);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function _fmtDate(val) {
  if (!val) return '';
  const d = new Date(val);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}
