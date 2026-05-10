#!/usr/bin/env python3
"""
migrate.py — העברת נתונים מגאס ל-Supabase
הרץ: python3 migrate.py
"""

import json
import urllib.request
import urllib.parse
import urllib.error
import re
import sys

GAS_URL = (
    "https://script.google.com/macros/s/"
    "AKfycbxST_n3NGcPU99_PmDHLJO3W1Sb12rel6Sf_Y-ihzBFIGmmsYMOfrrxRZMLf-CMETcp/exec"
)
SB_URL  = "https://gritbcrdxpeycnxrlulp.supabase.co"
SB_KEY  = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyaXRiY3JkeHBleWNueHJsdWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI1NzgsImV4cCI6MjA5MzkxODU3OH0"
    ".PRk_DQeHF4vGy-0qZH2XFIUOoOQ_cekPOW_gWdmHXXc"
)

# ── עזרים ─────────────────────────────────────────────────────────────────────────

def gas_date(val):
    """DD/MM/YYYY → YYYY-MM-DD. מחזיר None אם ריק."""
    if not val or not str(val).strip():
        return None
    s = str(val).strip()
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s  # כבר בפורמט הנכון
    print(f"  ⚠ תאריך לא מוכר: {val!r} — מדולג")
    return None

def norm_phone(phone):
    """נרמול מספר טלפון ישראלי."""
    p = re.sub(r'[\s\-\(\)]', '', str(phone))
    if p.startswith('+972'):
        p = '0' + p[4:]
    elif p.startswith('972'):
        p = '0' + p[3:]
    if not p.startswith('0'):
        p = '0' + p
    return p

def gas_get(action, extra_params=None):
    """קריאת GET ל-GAS API."""
    params = {'action': action}
    if extra_params:
        params.update(extra_params)
    url = GAS_URL + '?' + urllib.parse.urlencode(params)
    print(f"  ← GAS {action}…", end=' ', flush=True)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode('utf-8')
        data = json.loads(raw)
        if isinstance(data, dict) and not data.get('success', True):
            raise RuntimeError(data.get('error', 'שגיאה לא ידועה'))
        result = data.get('data', data) if isinstance(data, dict) else data
        print(f"{len(result) if isinstance(result, list) else '?'} רשומות")
        return result
    except Exception as e:
        print(f"שגיאה: {e}")
        raise

def sb_upsert(table, rows, batch=200):
    """Upsert ל-Supabase בבאצ'ים."""
    if not rows:
        print(f"  ⚠ אין רשומות ל-{table}")
        return
    total = 0
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        body = json.dumps(chunk).encode('utf-8')
        url = f"{SB_URL}/rest/v1/{table}"
        req = urllib.request.Request(
            url,
            data=body,
            method='POST',
            headers={
                'apikey':        SB_KEY,
                'Authorization': f'Bearer {SB_KEY}',
                'Content-Type':  'application/json',
                'Prefer':        'resolution=merge-duplicates,return=minimal',
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                r.read()
            total += len(chunk)
        except urllib.error.HTTPError as e:
            body_err = e.read().decode('utf-8', errors='replace')
            print(f"\n  ✗ HTTP {e.code} ב-{table}: {body_err[:300]}")
            raise
    print(f"  ✓ {table}: {total} רשומות נשמרו")

# ── המרות ─────────────────────────────────────────────────────────────────────────

def map_rider(r):
    return {
        'tid':        r['tid'],
        'name':       r.get('name', ''),
        'phone':      norm_phone(r.get('phone', '0')),
        'email':      r.get('email', ''),
        'city':       r.get('city', ''),
        'dob':        gas_date(r.get('dob', '')),
        'gender':     r.get('gender', ''),
        'permission': r.get('permission', 'משתמש'),
        'ride_style': r.get('rideStyle', 'סינגל'),
        'exam_date':  gas_date(r.get('examDate', '')),
    }

def map_bike(b):
    return {
        'id':     b['id'],
        'name':   b.get('name', ''),
        'frame':  b.get('frame', ''),
        'drive':  b.get('drive', ''),
        'status': b.get('status', 'תקין'),
    }

def map_event(e):
    return {
        'id':          e['id'],
        'date':        gas_date(e.get('date', '')) or '2000-01-01',
        'description': e.get('description', ''),
        'km':          float(e.get('km', 0) or 0),
        'climb':       float(e.get('climb', 0) or 0),
        'meet_point':  e.get('meetPoint', ''),
        'meet_time':   e.get('meetTime', '06:00'),
        'captain':     e.get('captain', ''),
        'status':      e.get('status', 'פעיל'),
    }

def map_registration(reg):
    event_id = reg.get('eventId', '')
    tid      = reg.get('tid', '')
    created  = gas_date(reg.get('createdAt', '')) or '2000-01-01'
    return {
        'id':           f"{event_id}-{tid}",
        'event_id':     event_id,
        'tid':          tid,
        'role':         reg.get('role', ''),
        'bike_id':      reg.get('bikeId', ''),
        'partner_name': reg.get('partnerName', '—'),
        'partner_tid':  reg.get('partnerTid', ''),
        'created_at':   created,
    }

def map_maintenance(m):
    return {
        'id':        m['id'],
        'bike_id':   m.get('bikeId', ''),
        'bike_name': m.get('bikeName', ''),
        'fault':     m.get('fault', ''),
        'date_in':   gas_date(m.get('dateIn', '')),
        'date_out':  gas_date(m.get('dateOut', '')),
        'status':    m.get('status', 'בתיקון'),
    }

# ── מיגרציה ראשית ──────────────────────────────────────────────────────────────────────────

def run():
    print("=" * 55)
    print("  מיגרציה: GAS → Supabase")
    print("=" * 55)

    errors = []

    # 1. רוכבים
    print("\n[1/5] רוכבים")
    try:
        raw = gas_get('getAllRiders')
        rows = [map_rider(r) for r in raw]
        sb_upsert('riders', rows)
    except Exception as e:
        errors.append(f"riders: {e}")

    # 2. אופניים
    print("\n[2/5] אופניים")
    try:
        raw = gas_get('getBikes')
        rows = [map_bike(b) for b in raw]
        sb_upsert('bikes', rows)
    except Exception as e:
        errors.append(f"bikes: {e}")

    # 3. אירועים
    print("\n[3/5] אירועים")
    try:
        raw = gas_get('getAllEvents')
        # getAllEvents מחזיר {upcoming, past, cancelled} או רשימה ישירה
        if isinstance(raw, dict):
            events = (
                raw.get('upcoming', []) +
                raw.get('past', []) +
                raw.get('cancelled', [])
            )
        else:
            events = raw
        rows = [map_event(e) for e in events]
        sb_upsert('events', rows)
    except Exception as e:
        errors.append(f"events: {e}")

    # 4. רישומים (צריך את כל אירועי-העבר + עתיד)
    print("\n[4/5] רישומים לאירועים")
    try:
        res = gas_get('getAllEvents')
        if isinstance(res, dict):
            all_events = res.get('upcoming', []) + res.get('past', []) + res.get('cancelled', [])
        else:
            all_events = res

        all_regs = []
        for ev in all_events:
            eid = ev['id']
            try:
                regs_raw = gas_get('getRegistrations', {'eventId': eid})
                if isinstance(regs_raw, list):
                    for r in regs_raw:
                        r['eventId'] = eid
                    all_regs.extend(regs_raw)
            except Exception:
                pass

        rows = [map_registration(r) for r in all_regs]
        sb_upsert('registrations', rows)
    except Exception as e:
        errors.append(f"registrations: {e}")

    # 5. תחזוקה
    print("\n[5/5] תחזוקה")
    try:
        raw = gas_get('getMaintenance')
        rows = [map_maintenance(m) for m in raw]
        sb_upsert('maintenance', rows)
    except Exception as e:
        errors.append(f"maintenance: {e}")

    # סיכום
    print("\n" + "=" * 55)
    if errors:
        print("הסתיים עם שגיאות:")
        for err in errors:
            print(f"  ✗ {err}")
        sys.exit(1)
    else:
        print("✅ המיגרציה הושלמה בהצלחה!")
    print("=" * 55)

if __name__ == '__main__':
    run()
