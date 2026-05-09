-- ═══════════════════════════════════════════════════════════════
-- CLUB CYCLING — Supabase Schema
-- הרץ קובץ זה ב-Supabase SQL Editor לפני rpc.sql
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS riders (
  id          UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  tid         TEXT    UNIQUE NOT NULL,
  name        TEXT    NOT NULL,
  phone       TEXT    NOT NULL,
  email       TEXT    NOT NULL DEFAULT '',
  city        TEXT    NOT NULL DEFAULT '',
  dob         DATE,
  gender      TEXT    NOT NULL DEFAULT '',
  permission  TEXT    NOT NULL DEFAULT 'משתמש',
  ride_style  TEXT    NOT NULL DEFAULT 'סינגל',
  exam_date   DATE,
  exam_expiry DATE    GENERATED ALWAYS AS (
    CASE WHEN exam_date IS NOT NULL
      THEN exam_date + INTERVAL '1 year'
      ELSE NULL
    END
  ) STORED
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT    PRIMARY KEY,   -- E001, E002 ...
  date        DATE    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  km          NUMERIC NOT NULL DEFAULT 0,
  climb       NUMERIC NOT NULL DEFAULT 0,
  meet_point  TEXT    NOT NULL DEFAULT '',
  meet_time   TEXT    NOT NULL DEFAULT '06:00',
  captain     TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'פעיל'
);

CREATE TABLE IF NOT EXISTS registrations (
  id           TEXT  PRIMARY KEY,   -- eventId-tid
  event_id     TEXT  NOT NULL REFERENCES events(id),
  tid          TEXT  NOT NULL REFERENCES riders(tid),
  role         TEXT  NOT NULL DEFAULT '',
  bike_id      TEXT  NOT NULL DEFAULT '',
  partner_name TEXT  NOT NULL DEFAULT '—',
  partner_tid  TEXT  NOT NULL DEFAULT '',
  created_at   DATE  NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS bikes (
  id     TEXT PRIMARY KEY,          -- B001, B002 ...
  name   TEXT NOT NULL,
  frame  TEXT NOT NULL DEFAULT '',
  drive  TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'תקין'
);

CREATE TABLE IF NOT EXISTS maintenance (
  id        TEXT PRIMARY KEY,       -- M + timestamp suffix
  bike_id   TEXT NOT NULL,
  bike_name TEXT NOT NULL DEFAULT '',
  fault     TEXT NOT NULL DEFAULT '',
  date_in   DATE,
  date_out  DATE,
  status    TEXT NOT NULL DEFAULT 'בתיקון'
);

-- ─────────────────────────────────────────────
-- VIEW: riders_view — מוסיף exam_status ו-age
-- ─────────────────────────────────────────────

CREATE OR REPLACE VIEW riders_view AS
SELECT
  r.*,
  CASE
    WHEN r.exam_date   IS NULL          THEN 'אין בדיקה'
    WHEN r.exam_expiry >= CURRENT_DATE  THEN '✅ תקין'
    ELSE                                     '❌ פג תוקף'
  END  AS exam_status,
  CASE
    WHEN r.dob IS NOT NULL
      THEN DATE_PART('year', AGE(r.dob))::INTEGER
    ELSE NULL
  END  AS age
FROM riders r;

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- הערה: הפעל RLS בדשבורד עבור כל טבלה.
-- בשלב זה מדיניות ברירת מחדל: anon יכול לקרוא/לכתוב.
-- לאחר הטמעת auth מלא — הגבל לפי role.
-- ─────────────────────────────────────────────

ALTER TABLE riders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bikes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance   ENABLE ROW LEVEL SECURITY;

-- Allow anon to read/write (open policy — tighten after auth is implemented)
CREATE POLICY "anon_all_riders"        ON riders        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_events"        ON events        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_registrations" ON registrations FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_bikes"         ON bikes         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_maintenance"   ON maintenance   FOR ALL TO anon USING (true) WITH CHECK (true);

-- Grant execute on all functions to anon
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT ON riders_view TO anon;
