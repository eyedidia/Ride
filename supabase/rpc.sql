-- ═══════════════════════════════════════════════════════════════
-- CLUB CYCLING — Supabase RPC Functions
-- הרץ קובץ זה ב-Supabase SQL Editor אחרי schema.sql
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- HELPERS
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION normalize_phone(p TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  v := regexp_replace(p, '[\s\-\(\)]', '', 'g');
  IF v LIKE '+972%' THEN v := '0' || substring(v FROM 5); END IF;
  IF v LIKE '972%'  THEN v := '0' || substring(v FROM 4); END IF;
  IF NOT v LIKE '0%' THEN v := '0' || v; END IF;
  RETURN v;
END;
$$;

-- בדיקת הרשאות מנהל — מאמתת שה-tid הנתון שייך לרוכב עם role מנהל
CREATE OR REPLACE FUNCTION _require_admin(p_caller_tid TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v_perm TEXT;
BEGIN
  IF p_caller_tid IS NULL OR p_caller_tid = '' THEN
    RAISE EXCEPTION 'אין הרשאה: לא זוהה משתמש';
  END IF;
  SELECT permission INTO v_perm FROM riders WHERE tid = p_caller_tid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'אין הרשאה: משתמש לא נמצא';
  END IF;
  IF v_perm IS NULL OR NOT (
    v_perm LIKE '%מנהל%'
  ) THEN
    RAISE EXCEPTION 'אין הרשאה לביצוע פעולה זו';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION next_event_id()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE max_num INT;
BEGIN
  SELECT COALESCE(MAX(substring(id FROM 2)::INT), 0)
  INTO max_num FROM events WHERE id ~ '^E\d+$';
  RETURN 'E' || lpad((max_num + 1)::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION next_bike_id()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE max_num INT;
BEGIN
  SELECT COALESCE(MAX(substring(id FROM 2)::INT), 0)
  INTO max_num FROM bikes WHERE id ~ '^B\d+$';
  RETURN 'B' || lpad((max_num + 1)::TEXT, 3, '0');
END;
$$;

-- ─────────────────────────────────────────────
-- 1. LOGIN
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION login(p_phone TEXT, p_name TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  r            riders_view%ROWTYPE;
  stored_name  TEXT;
  input_name   TEXT;
  can_register BOOLEAN;
BEGIN
  SELECT * INTO r FROM riders_view
  WHERE phone = normalize_phone(p_phone)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'המספר טלפון אינו רשום במערכת';
  END IF;

  stored_name := lower(trim(r.name));
  input_name  := lower(trim(p_name));

  -- Escape LIKE metacharacters in user-supplied input so '%' / '_' can't bypass auth
  input_name := replace(replace(input_name, '%', '\%'), '_', '\_');

  IF NOT (stored_name LIKE '%' || input_name || '%' ESCAPE '\'
       OR input_name  LIKE '%' || split_part(stored_name, ' ', 1) || '%' ESCAPE '\') THEN
    RAISE EXCEPTION 'הפרטים שהוזנו אינם תואמים';
  END IF;

  can_register := (r.permission = 'מנהל') OR (r.exam_status = '✅ תקין');

  RETURN jsonb_build_object(
    'tid',         r.tid,
    'name',        r.name,
    'city',        r.city,
    'rideStyle',   r.ride_style,
    'permission',  r.permission,
    'examStatus',  r.exam_status,
    'examExpiry',  to_char(r.exam_expiry, 'DD/MM/YYYY'),
    'dob',         to_char(r.dob, 'DD/MM/YYYY'),
    'isAdmin',     (r.permission = 'מנהל'),
    'canRegister', can_register
  );
END;
$$;

-- ─────────────────────────────────────────────
-- 2. GET_EVENTS — עתידיים פעילים
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_events()
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',          e.id,
      'date',        to_char(e.date, 'DD/MM/YYYY'),
      'description', e.description,
      'km',          e.km,
      'climb',       e.climb,
      'meetPoint',   e.meet_point,
      'meetTime',    e.meet_time,
      'captain',     e.captain,
      'status',      e.status
    ) ORDER BY e.date ASC
  )
  INTO result
  FROM events e
  WHERE e.date >= CURRENT_DATE AND e.status = 'פעיל';

  RETURN COALESCE(result, '[]'::JSONB);
END;
$$;

-- ─────────────────────────────────────────────
-- 3. GET_ALL_EVENTS — מנהל: upcoming / past / cancelled
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_all_events()
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  upcoming  JSONB;
  past      JSONB;
  cancelled JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', e.id, 'date', to_char(e.date,'DD/MM/YYYY'),
      'description', e.description, 'km', e.km, 'climb', e.climb,
      'meetPoint', e.meet_point, 'meetTime', e.meet_time,
      'captain', e.captain, 'status', e.status
    ) ORDER BY e.date ASC
  ) INTO upcoming  FROM events e WHERE e.status <> 'בוטל' AND e.date >= CURRENT_DATE;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', e.id, 'date', to_char(e.date,'DD/MM/YYYY'),
      'description', e.description, 'km', e.km, 'climb', e.climb,
      'meetPoint', e.meet_point, 'meetTime', e.meet_time,
      'captain', e.captain, 'status', e.status,
      'actualKm',          e.actual_km,
      'actualClimb',       e.actual_climb,
      'actualDescription', e.actual_description
    ) ORDER BY e.date DESC
  ) INTO past      FROM events e WHERE e.status <> 'בוטל' AND e.date < CURRENT_DATE;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', e.id, 'date', to_char(e.date,'DD/MM/YYYY'),
      'description', e.description, 'km', e.km, 'climb', e.climb,
      'meetPoint', e.meet_point, 'meetTime', e.meet_time,
      'captain', e.captain, 'status', e.status
    ) ORDER BY e.date DESC
  ) INTO cancelled FROM events e WHERE e.status = 'בוטל';

  RETURN jsonb_build_object(
    'upcoming',  COALESCE(upcoming,  '[]'::JSONB),
    'past',      COALESCE(past,      '[]'::JSONB),
    'cancelled', COALESCE(cancelled, '[]'::JSONB)
  );
END;
$$;

-- ─────────────────────────────────────────────
-- 4. GET_REGISTRATIONS
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_registrations(p_event_id TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'registrationId', reg.id,
      'tid',            reg.tid,
      'name',           r.name,
      'role',           reg.role,
      'bike',           reg.bike_id,
      'partner',        reg.partner_name,
      'partnerTid',     reg.partner_tid,
      'date',           to_char(reg.created_at, 'DD/MM/YYYY'),
      'attended',       reg.attended
    )
  )
  INTO result
  FROM registrations reg
  JOIN riders r ON r.tid = reg.tid
  WHERE reg.event_id = p_event_id;

  RETURN COALESCE(result, '[]'::JSONB);
END;
$$;

-- ─────────────────────────────────────────────
-- 5. GET_EVENT_COUNTS
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_event_counts()
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_object_agg(event_id, cnt)
  INTO result
  FROM (
    SELECT event_id, COUNT(*) AS cnt
    FROM registrations
    GROUP BY event_id
  ) sub;

  RETURN COALESCE(result, '{}'::JSONB);
END;
$$;

-- ─────────────────────────────────────────────
-- 6. GET_RIDE_HISTORY
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_ride_history(p_tid TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'date',        to_char(e.date, 'DD/MM/YYYY'),
      'description', COALESCE(e.actual_description, e.description),
      'km',          COALESCE(e.actual_km,          e.km),
      'climb',       COALESCE(e.actual_climb,        e.climb),
      'role',        reg.role,
      'bike',        reg.bike_id,
      'partner',     reg.partner_name
    ) ORDER BY e.date DESC
  )
  INTO result
  FROM registrations reg
  JOIN events e ON e.id = reg.event_id
  WHERE reg.tid = p_tid
    AND e.date < CURRENT_DATE
    AND reg.attended = TRUE;

  RETURN COALESCE(result, '[]'::JSONB);
END;
$$;

-- ─────────────────────────────────────────────
-- 7. REGISTER_TO_EVENT
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION register_to_event(
  p_tid      TEXT,
  p_event_id TEXT,
  p_role     TEXT DEFAULT '',
  p_bike_id  TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_exam_status TEXT;
  v_reg_id      TEXT;
BEGIN
  -- בדיקת כפילות עם נעילה
  PERFORM 1 FROM registrations
  WHERE event_id = p_event_id AND tid = p_tid
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'הרוכב כבר רשום לאירוע זה';
  END IF;

  -- בדיקת בדיקה ארגומטרית
  SELECT exam_status INTO v_exam_status FROM riders_view WHERE tid = p_tid;
  IF NOT FOUND THEN RAISE EXCEPTION 'רוכב לא נמצא'; END IF;

  IF v_exam_status LIKE '%פג תוקף%' OR v_exam_status LIKE '%אין בדיקה%' THEN
    RAISE EXCEPTION 'לא ניתן להירשם — אין בדיקה ארגומטרית בתוקף';
  END IF;

  v_reg_id := p_event_id || '-' || p_tid;

  INSERT INTO registrations(id, event_id, tid, role, bike_id, partner_name, partner_tid, created_at)
  VALUES (v_reg_id, p_event_id, p_tid, p_role, p_bike_id, '—', '', CURRENT_DATE);

  RETURN jsonb_build_object('success', true, 'registrationId', v_reg_id);
END;
$$;

-- ─────────────────────────────────────────────
-- 8. ASSIGN_PARTNER
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assign_partner(
  p_caller_tid  TEXT,
  p_event_id    TEXT,
  p_captain_tid TEXT,
  p_stoker_tid  TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_stoker_name TEXT;
BEGIN
  PERFORM _require_admin(p_caller_tid);
  IF p_stoker_tid IS NOT NULL AND p_stoker_tid <> '' THEN
    -- שם הסטוקר מהטבלה
    SELECT name INTO v_stoker_name FROM riders WHERE tid = p_stoker_tid;

    -- עדכן שורת הקפטן
    UPDATE registrations
    SET partner_name = COALESCE(v_stoker_name, p_stoker_tid),
        partner_tid  = p_stoker_tid
    WHERE event_id = p_event_id AND tid = p_captain_tid;

    IF NOT FOUND THEN RAISE EXCEPTION 'קפטן לא נמצא בהרשמות'; END IF;

    -- מחק שורת הסטוקר
    DELETE FROM registrations WHERE event_id = p_event_id AND tid = p_stoker_tid;
  ELSE
    -- ניקוי בלבד
    UPDATE registrations
    SET partner_name = '—', partner_tid = ''
    WHERE event_id = p_event_id AND tid = p_captain_tid;

    IF NOT FOUND THEN RAISE EXCEPTION 'קפטן לא נמצא בהרשמות'; END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 9. UNASSIGN_PARTNER
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION unassign_partner(
  p_caller_tid  TEXT,
  p_event_id    TEXT,
  p_captain_tid TEXT,
  p_stoker_tid  TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  -- ניקוי שורת הקפטן
  UPDATE registrations
  SET partner_name = '—', partner_tid = ''
  WHERE event_id = p_event_id AND tid = p_captain_tid;

  IF NOT FOUND THEN RAISE EXCEPTION 'קפטן לא נמצא'; END IF;

  -- החזרת שורת הסטוקר
  IF p_stoker_tid IS NOT NULL AND p_stoker_tid <> '' THEN
    INSERT INTO registrations(id, event_id, tid, role, bike_id, partner_name, partner_tid, created_at)
    VALUES (
      p_event_id || '-' || p_stoker_tid,
      p_event_id, p_stoker_tid, 'סטוקר', '', '—', '', CURRENT_DATE
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 10. DISABLE_BIKE
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION disable_bike(p_caller_tid TEXT, p_bike_id TEXT, p_fault TEXT DEFAULT 'לא צוין')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_bike_name TEXT;
  v_rec_id    TEXT;
BEGIN
  PERFORM _require_admin(p_caller_tid);
  UPDATE bikes SET status = 'מושבת'
  WHERE id = p_bike_id
  RETURNING name INTO v_bike_name;

  IF NOT FOUND THEN RAISE EXCEPTION 'אופניים לא נמצאו'; END IF;

  v_rec_id := 'M' || right(extract(epoch FROM now())::BIGINT::TEXT, 6);

  INSERT INTO maintenance(id, bike_id, bike_name, fault, date_in, status)
  VALUES (v_rec_id, p_bike_id, v_bike_name, p_fault, CURRENT_DATE, 'בתיקון');

  RETURN jsonb_build_object('success', true, 'recId', v_rec_id);
END;
$$;

-- ─────────────────────────────────────────────
-- 11. ENABLE_BIKE
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION enable_bike(p_caller_tid TEXT, p_bike_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  UPDATE bikes SET status = 'תקין' WHERE id = p_bike_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'אופניים לא נמצאו'; END IF;

  -- סגור את רשומת התחזוקה הפתוחה האחרונה
  UPDATE maintenance
  SET date_out = CURRENT_DATE, status = 'תוקן'
  WHERE id = (
    SELECT id FROM maintenance
    WHERE bike_id = p_bike_id AND status = 'בתיקון'
    ORDER BY date_in DESC NULLS LAST
    LIMIT 1
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 12. ADD_RIDER
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION add_rider(
  p_caller_tid TEXT,
  p_tid        TEXT,
  p_name       TEXT,
  p_phone      TEXT,
  p_email      TEXT    DEFAULT '',
  p_city       TEXT    DEFAULT '',
  p_dob        DATE    DEFAULT NULL,
  p_gender     TEXT    DEFAULT '',
  p_permission TEXT    DEFAULT 'משתמש',
  p_ride_style TEXT    DEFAULT 'סינגל'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  IF EXISTS (SELECT 1 FROM riders WHERE tid = p_tid) THEN
    RAISE EXCEPTION 'תעודת זהות כבר קיימת במערכת';
  END IF;

  INSERT INTO riders(tid, name, phone, email, city, dob, gender, permission, ride_style)
  VALUES (p_tid, p_name, normalize_phone(p_phone), p_email, p_city,
          p_dob, p_gender, p_permission, p_ride_style);

  RETURN jsonb_build_object('success', true, 'message', 'רוכב ' || p_name || ' נוסף בהצלחה');
END;
$$;

-- ─────────────────────────────────────────────
-- 13. ADD_EVENT
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION add_event(
  p_caller_tid  TEXT,
  p_date        DATE,
  p_description TEXT,
  p_km          NUMERIC DEFAULT 0,
  p_climb       NUMERIC DEFAULT 0,
  p_meet_point  TEXT    DEFAULT '',
  p_meet_time   TEXT    DEFAULT '06:00',
  p_captain     TEXT    DEFAULT '',
  p_status      TEXT    DEFAULT 'פעיל'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id TEXT;
BEGIN
  PERFORM _require_admin(p_caller_tid);
  v_id := next_event_id();
  INSERT INTO events(id, date, description, km, climb, meet_point, meet_time, captain, status)
  VALUES (v_id, p_date, p_description, p_km, p_climb, p_meet_point, p_meet_time, p_captain, p_status);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- ─────────────────────────────────────────────
-- 14. ADD_BIKE
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION add_bike(
  p_caller_tid TEXT,
  p_name       TEXT,
  p_frame      TEXT DEFAULT '',
  p_drive      TEXT DEFAULT '',
  p_status     TEXT DEFAULT 'תקין'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id TEXT;
BEGIN
  PERFORM _require_admin(p_caller_tid);
  v_id := next_bike_id();
  INSERT INTO bikes(id, name, frame, drive, status)
  VALUES (v_id, p_name, p_frame, p_drive, p_status);
  RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- ─────────────────────────────────────────────
-- 15. UPDATE_EVENT
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_event(
  p_caller_tid  TEXT,
  p_event_id    TEXT,
  p_date        DATE,
  p_description TEXT,
  p_km          NUMERIC DEFAULT 0,
  p_climb       NUMERIC DEFAULT 0,
  p_meet_point  TEXT    DEFAULT '',
  p_meet_time   TEXT    DEFAULT '06:00',
  p_captain     TEXT    DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  UPDATE events
  SET date = p_date, description = p_description,
      km = p_km, climb = p_climb,
      meet_point = p_meet_point, meet_time = p_meet_time,
      captain = p_captain
  WHERE id = p_event_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'אירוע לא נמצא'; END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 16. UPDATE_EVENT_ACTUAL (admin) — נתוני אמת לאחר רכיבה
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_event_actual(
  p_caller_tid         TEXT,
  p_event_id           TEXT,
  p_actual_km          NUMERIC,
  p_actual_climb       NUMERIC,
  p_actual_description TEXT,
  p_attended_tids      TEXT[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);

  UPDATE events
  SET actual_km          = p_actual_km,
      actual_climb       = p_actual_climb,
      actual_description = p_actual_description
  WHERE id = p_event_id;

  -- אפס השתתפות לכולם, ואז סמן את מי שהגיע
  UPDATE registrations SET attended = FALSE WHERE event_id = p_event_id;
  UPDATE registrations SET attended = TRUE
  WHERE event_id = p_event_id AND tid = ANY(p_attended_tids);
END;
$$;
GRANT EXECUTE ON FUNCTION update_event_actual(TEXT,TEXT,NUMERIC,NUMERIC,TEXT,TEXT[]) TO anon;

-- ─────────────────────────────────────────────
-- 17. UPDATE_RIDER (admin)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_rider(
  p_caller_tid TEXT,
  p_tid        TEXT,
  p_name       TEXT,
  p_phone      TEXT,
  p_email      TEXT    DEFAULT '',
  p_city       TEXT    DEFAULT '',
  p_ride_style TEXT    DEFAULT 'סינגל',
  p_permission TEXT    DEFAULT 'משתמש'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  UPDATE riders
  SET name = p_name, phone = normalize_phone(p_phone),
      email = p_email, city = p_city,
      ride_style = p_ride_style, permission = p_permission
  WHERE tid = p_tid;
  IF NOT FOUND THEN RAISE EXCEPTION 'רוכב לא נמצא'; END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 17. DELETE_RIDER (admin)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_rider(p_caller_tid TEXT, p_tid TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  DELETE FROM registrations WHERE tid = p_tid;
  DELETE FROM riders WHERE tid = p_tid;
  IF NOT FOUND THEN RAISE EXCEPTION 'רוכב לא נמצא'; END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 18. UPDATE_BIKE (admin)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_bike(
  p_caller_tid TEXT,
  p_bike_id    TEXT,
  p_name       TEXT,
  p_frame      TEXT DEFAULT '',
  p_drive      TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  UPDATE bikes SET name = p_name, frame = p_frame, drive = p_drive
  WHERE id = p_bike_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'אופניים לא נמצאו'; END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 19. DELETE_BIKE (admin)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_bike(p_caller_tid TEXT, p_bike_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  DELETE FROM bikes WHERE id = p_bike_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'אופניים לא נמצאו'; END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 20. CANCEL_EVENT (admin)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cancel_event(p_caller_tid TEXT, p_event_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  UPDATE events SET status = 'בוטל' WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'אירוע לא נמצא'; END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 21. ASSIGN_BIKE (admin)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assign_bike(
  p_caller_tid TEXT,
  p_event_id   TEXT,
  p_tid        TEXT,
  p_bike_id    TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  UPDATE registrations SET bike_id = p_bike_id
  WHERE event_id = p_event_id AND tid = p_tid;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 22. UPDATE_EXAM_DATE (admin)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_exam_date(
  p_caller_tid TEXT,
  p_tid        TEXT,
  p_exam_date  DATE
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM _require_admin(p_caller_tid);
  UPDATE riders SET exam_date = p_exam_date WHERE tid = p_tid;
  IF NOT FOUND THEN RAISE EXCEPTION 'רוכב לא נמצא'; END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 23. UPDATE_MY_PROFILE (self — no admin check)
-- ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS update_my_profile CASCADE;
CREATE OR REPLACE FUNCTION update_my_profile(
  p_tid    TEXT,
  p_phone  TEXT    DEFAULT NULL,
  p_city   TEXT    DEFAULT NULL,
  p_email  TEXT    DEFAULT NULL,
  p_gender TEXT    DEFAULT NULL,
  p_dob    DATE    DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM riders WHERE tid = p_tid) THEN
    RAISE EXCEPTION 'רוכב לא נמצא';
  END IF;
  UPDATE riders SET
    phone  = COALESCE(CASE WHEN p_phone  IS NOT NULL THEN normalize_phone(p_phone) END, phone),
    city   = COALESCE(p_city,   city),
    email  = COALESCE(p_email,  email),
    gender = COALESCE(p_gender, gender),
    dob    = COALESCE(p_dob,    dob)
  WHERE tid = p_tid;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────
-- 24. CANCEL_REGISTRATION (self — no admin check)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cancel_registration(p_tid TEXT, p_event_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM riders WHERE tid = p_tid) THEN
    RAISE EXCEPTION 'רוכב לא נמצא';
  END IF;
  DELETE FROM registrations WHERE event_id = p_event_id AND tid = p_tid;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- Grant execute to anon role
GRANT EXECUTE ON FUNCTION normalize_phone(TEXT)                          TO anon;
GRANT EXECUTE ON FUNCTION next_event_id()                                TO anon;
GRANT EXECUTE ON FUNCTION next_bike_id()                                 TO anon;
GRANT EXECUTE ON FUNCTION login(TEXT,TEXT)                               TO anon;
GRANT EXECUTE ON FUNCTION get_events()                                   TO anon;
GRANT EXECUTE ON FUNCTION get_all_events()                               TO anon;
GRANT EXECUTE ON FUNCTION get_registrations(TEXT)                        TO anon;
GRANT EXECUTE ON FUNCTION get_event_counts()                             TO anon;
GRANT EXECUTE ON FUNCTION get_ride_history(TEXT)                         TO anon;
GRANT EXECUTE ON FUNCTION register_to_event(TEXT,TEXT,TEXT,TEXT)         TO anon;
-- פונקציות admin — הגישה דרך anon מוגבלת ע"י _require_admin בתוך הפונקציה
GRANT EXECUTE ON FUNCTION assign_partner(TEXT,TEXT,TEXT,TEXT)            TO anon;
GRANT EXECUTE ON FUNCTION unassign_partner(TEXT,TEXT,TEXT,TEXT)          TO anon;
GRANT EXECUTE ON FUNCTION disable_bike(TEXT,TEXT,TEXT)                   TO anon;
GRANT EXECUTE ON FUNCTION enable_bike(TEXT,TEXT)                         TO anon;
GRANT EXECUTE ON FUNCTION add_rider(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION add_event(TEXT,DATE,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION add_bike(TEXT,TEXT,TEXT,TEXT,TEXT)             TO anon;
GRANT EXECUTE ON FUNCTION update_event(TEXT,TEXT,DATE,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION update_rider(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION delete_rider(TEXT,TEXT)                        TO anon;
GRANT EXECUTE ON FUNCTION update_bike(TEXT,TEXT,TEXT,TEXT,TEXT)          TO anon;
GRANT EXECUTE ON FUNCTION delete_bike(TEXT,TEXT)                         TO anon;
GRANT EXECUTE ON FUNCTION cancel_event(TEXT,TEXT)                        TO anon;
GRANT EXECUTE ON FUNCTION assign_bike(TEXT,TEXT,TEXT,TEXT)               TO anon;
GRANT EXECUTE ON FUNCTION update_exam_date(TEXT,TEXT,DATE)               TO anon;
GRANT EXECUTE ON FUNCTION update_my_profile(TEXT,TEXT,TEXT,TEXT,TEXT,DATE) TO anon;
GRANT EXECUTE ON FUNCTION cancel_registration(TEXT,TEXT)                 TO anon;

-- ─────────────────────────────────────────────
-- SMTP SETTINGS — שמירת הגדרות שרת מייל
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION save_smtp_settings(
  p_code      TEXT,
  p_host      TEXT,
  p_port      INTEGER,
  p_secure    BOOLEAN,
  p_user      TEXT,
  p_pass      TEXT,
  p_from_name TEXT
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_code <> '1981' THEN
    RAISE EXCEPTION 'קוד טכנאי שגוי';
  END IF;
  INSERT INTO smtp_settings (id, host, port, secure, smtp_user, smtp_pass, from_name)
  VALUES (1, p_host, p_port, p_secure, p_user, p_pass, p_from_name)
  ON CONFLICT (id) DO UPDATE SET
    host      = EXCLUDED.host,
    port      = EXCLUDED.port,
    secure    = EXCLUDED.secure,
    smtp_user = EXCLUDED.smtp_user,
    smtp_pass = CASE WHEN p_pass = '' THEN smtp_settings.smtp_pass ELSE EXCLUDED.smtp_pass END,
    from_name = EXCLUDED.from_name;
END;
$$;
GRANT EXECUTE ON FUNCTION save_smtp_settings(TEXT,TEXT,INTEGER,BOOLEAN,TEXT,TEXT,TEXT) TO anon;

-- קריאת הגדרות SMTP (ללא סיסמה) — מוגן בקוד טכנאי
CREATE OR REPLACE FUNCTION get_smtp_settings(p_code TEXT)
RETURNS TABLE(host TEXT, port INTEGER, secure BOOLEAN, smtp_user TEXT, from_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_code <> '1981' THEN
    RAISE EXCEPTION 'קוד טכנאי שגוי';
  END IF;
  RETURN QUERY
    SELECT s.host, s.port, s.secure, s.smtp_user, s.from_name
    FROM smtp_settings s WHERE s.id = 1;
END;
$$;
GRANT EXECUTE ON FUNCTION get_smtp_settings(TEXT) TO anon;
