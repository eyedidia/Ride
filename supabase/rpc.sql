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

  IF NOT (stored_name LIKE '%' || input_name || '%'
       OR input_name  LIKE '%' || split_part(stored_name, ' ', 1) || '%') THEN
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
      'captain', e.captain, 'status', e.status
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
      'date',           to_char(reg.created_at, 'DD/MM/YYYY')
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
      'description', e.description,
      'km',          e.km,
      'climb',       e.climb,
      'role',        reg.role,
      'bike',        reg.bike_id,
      'partner',     reg.partner_name
    ) ORDER BY e.date DESC
  )
  INTO result
  FROM registrations reg
  JOIN events e ON e.id = reg.event_id
  WHERE reg.tid = p_tid
    AND e.date < CURRENT_DATE;

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
RETURNS JSONB LANGUAGE plpgsql AS $$
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
  p_event_id   TEXT,
  p_captain_tid TEXT,
  p_stoker_tid  TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_stoker_name TEXT;
BEGIN
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
  p_event_id    TEXT,
  p_captain_tid TEXT,
  p_stoker_tid  TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION disable_bike(p_bike_id TEXT, p_fault TEXT DEFAULT 'לא צוין')
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_bike_name TEXT;
  v_rec_id    TEXT;
BEGIN
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

CREATE OR REPLACE FUNCTION enable_bike(p_bike_id TEXT)
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
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
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
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
  p_date        DATE,
  p_description TEXT,
  p_km          NUMERIC DEFAULT 0,
  p_climb       NUMERIC DEFAULT 0,
  p_meet_point  TEXT    DEFAULT '',
  p_meet_time   TEXT    DEFAULT '06:00',
  p_captain     TEXT    DEFAULT '',
  p_status      TEXT    DEFAULT 'פעיל'
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_id TEXT;
BEGIN
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
  p_name   TEXT,
  p_frame  TEXT DEFAULT '',
  p_drive  TEXT DEFAULT '',
  p_status TEXT DEFAULT 'תקין'
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_id TEXT;
BEGIN
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
  p_event_id    TEXT,
  p_date        DATE,
  p_description TEXT,
  p_km          NUMERIC DEFAULT 0,
  p_climb       NUMERIC DEFAULT 0,
  p_meet_point  TEXT    DEFAULT '',
  p_meet_time   TEXT    DEFAULT '06:00',
  p_captain     TEXT    DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN
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

-- Grant execute to anon role
GRANT EXECUTE ON FUNCTION normalize_phone(TEXT)            TO anon;
GRANT EXECUTE ON FUNCTION next_event_id()                  TO anon;
GRANT EXECUTE ON FUNCTION next_bike_id()                   TO anon;
GRANT EXECUTE ON FUNCTION login(TEXT, TEXT)                TO anon;
GRANT EXECUTE ON FUNCTION get_events()                     TO anon;
GRANT EXECUTE ON FUNCTION get_all_events()                 TO anon;
GRANT EXECUTE ON FUNCTION get_registrations(TEXT)          TO anon;
GRANT EXECUTE ON FUNCTION get_event_counts()               TO anon;
GRANT EXECUTE ON FUNCTION get_ride_history(TEXT)           TO anon;
GRANT EXECUTE ON FUNCTION register_to_event(TEXT,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION assign_partner(TEXT,TEXT,TEXT)   TO anon;
GRANT EXECUTE ON FUNCTION unassign_partner(TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION disable_bike(TEXT,TEXT)          TO anon;
GRANT EXECUTE ON FUNCTION enable_bike(TEXT)                TO anon;
GRANT EXECUTE ON FUNCTION add_rider(TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION add_event(DATE,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION add_bike(TEXT,TEXT,TEXT,TEXT)    TO anon;
GRANT EXECUTE ON FUNCTION update_event(TEXT,DATE,TEXT,NUMERIC,NUMERIC,TEXT,TEXT,TEXT) TO anon;
