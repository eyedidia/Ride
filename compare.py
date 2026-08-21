#!/usr/bin/env python3
"""
compare.py — השוואת נתונים: GAS ↔ Supabase
הרץ: python3 compare.py
"""

import json
import os
import urllib.request
import urllib.parse
import urllib.error
import re
import sys

GAS_URL = os.environ.get(
    "GAS_URL",
    "https://script.google.com/macros/s/"
    "AKfycbxST_n3NGcPU99_PmDHLJO3W1Sb12rel6Sf_Y-ihzBFIGmmsYMOfrrxRZMLf-CMETcp/exec"
)
SB_URL = os.environ.get("SUPABASE_URL", "https://gritbcrdxpeycnxrlulp.supabase.co")
SB_KEY = os.environ.get(
    "SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdyaXRiY3JkeHBleWNueHJsdWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI1NzgsImV4cCI6MjA5MzkxODU3OH0"
    ".PRk_DQeHF4vGy-0qZH2XFIUOoOQ_cekPOW_gWdmHXXc"
)

# ── נרמול ─────────────────────────────────────────────────────────────────────

def gas_date(val):
    """DD/MM/YYYY → YYYY-MM-DD. מחזיר None אם ריק."""
    if not val or not str(val).strip():
        return None
    s = str(val).strip()
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)
    if m:
        return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    return None

def norm_phone(phone):
    """נרמול מספר טלפון ישראלי."""
    p = re.sub(r'[\s\-\(\)]', '', str(phone or ''))
    if p.startswith('+972'):
        p = '0' + p[4:]
    elif p.startswith('972'):
        p = '0' + p[3:]
    if p and not p.startswith('0'):
        p = '0' + p
    return p

def norm_val(v):
    """ממיר ערכים 'ריקים' שקולים לאותו ייצוג."""
    if v is None or v == '' or v == '—':
        return ''
    if isinstance(v, float) and v == int(v):
        return int(v)
    return v

# ── שאיבת נתונים ──────────────────────────────────────────────────────────────

def gas_get(action, extra_params=None):
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
            raise RuntimeError(data.get('error', 'שגיאה'))
        result = data.get('data', data) if isinstance(data, dict) else data
        print(f"{len(result) if isinstance(result, list) else '?'} רשומות")
        return result
    except Exception as e:
        print(f"שגיאה: {e}")
        raise

def sb_get(table, select='*', extra_params=None):
    params = {'select': select}
    if extra_params:
        params.update(extra_params)
    url = f"{SB_URL}/rest/v1/{table}?" + urllib.parse.urlencode(params)
    print(f"  → SB {table}…", end=' ', flush=True)
    req = urllib.request.Request(
        url,
        headers={
            'apikey':        SB_KEY,
            'Authorization': f'Bearer {SB_KEY}',
            'Range':         '0-9999',
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode('utf-8'))
        print(f"{len(data)} רשומות")
        return data
    except urllib.error.HTTPError as e:
        err = e.read().decode('utf-8', errors='replace')
        print(f"HTTP {e.code}: {err[:200]}")
        raise

# ── המרת GAS לפורמט Supabase ──────────────────────────────────────────────────

def map_rider(r):
    return {
        'tid':        str(r.get('tid', '')),
        'name':       r.get('name', ''),
        'phone':      norm_phone(r.get('phone', '')),
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
        'id':     b.get('id', ''),
        'name':   b.get('name', ''),
        'frame':  b.get('frame', ''),
        'drive':  b.get('drive', ''),
        'status': b.get('status', 'תקין'),
    }

def map_event(e):
    return {
        'id':          e.get('id', ''),
        'date':        gas_date(e.get('date', '')) or '2000-01-01',
        'description': e.get('description', ''),
        'km':          float(e.get('km', 0) or 0),
        'climb':       float(e.get('climb', 0) or 0),
        'meet_point':  e.get('meetPoint', ''),
        'meet_time':   e.get('meetTime', '06:00'),
        'captain':     e.get('captain', ''),
        'status':      e.get('status', 'פעיל'),
    }

def norm_tid(val):
    """מסיר .0 של float ורווחים מ-tid."""
    return re.sub(r'\.0+$', '', str(val or '').strip())

def map_registration(reg, event_id=None):
    eid = event_id or reg.get('eventId', '')
    tid = norm_tid(reg.get('tid', ''))
    return {
        'id':           f"{eid}-{tid}",
        'event_id':     eid,
        'tid':          tid,
        'role':         reg.get('role', ''),
        'bike_id':      reg.get('bike', '') or reg.get('bikeId', ''),
        'partner_name': reg.get('partner', '—') or reg.get('partnerName', '—'),
        'partner_tid':  norm_tid(reg.get('partnerTid', '') or reg.get('partner_tid', '')),
    }

def map_maintenance(m):
    return {
        'id':        m.get('id', ''),
        'bike_id':   m.get('bikeId', ''),
        'bike_name': m.get('bikeName', ''),
        'fault':     m.get('fault', ''),
        'date_in':   gas_date(m.get('dateIn', '')),
        'date_out':  gas_date(m.get('dateOut', '')),
        'status':    m.get('status', 'בתיקון'),
    }

# ── השוואה ────────────────────────────────────────────────────────────────────

COMPARE_FIELDS = {
    'riders':        ('tid',  ['name', 'phone', 'email', 'city', 'dob',
                                'gender', 'permission', 'ride_style', 'exam_date']),
    'events':        ('id',   ['date', 'description', 'km', 'climb',
                                'meet_point', 'meet_time', 'captain', 'status']),
    'registrations': ('id',   ['role', 'bike_id', 'partner_name', 'partner_tid']),
    'bikes':         ('id',   ['name', 'frame', 'drive', 'status']),
    'maintenance':   ('id',   ['bike_id', 'fault', 'date_in', 'date_out', 'status']),
}

def compare_table(name, gas_rows, sb_rows):
    key, fields = COMPARE_FIELDS[name]

    gas_map = {str(r[key]): r for r in gas_rows if r.get(key)}
    sb_map  = {str(r[key]): r for r in sb_rows  if r.get(key)}

    missing    = sorted(set(gas_map) - set(sb_map))   # ב-GAS אבל לא ב-SB
    extra      = sorted(set(sb_map)  - set(gas_map))  # ב-SB אבל לא ב-GAS
    mismatches = []

    for k in sorted(set(gas_map) & set(sb_map)):
        gr, sr = gas_map[k], sb_map[k]
        diffs = []
        for f in fields:
            gv = norm_val(gr.get(f))
            sv = norm_val(sr.get(f))
            # נרמול מספרי להשוואת km/climb
            if isinstance(gv, (int, float)) or isinstance(sv, (int, float)):
                try:
                    gv, sv = float(gv or 0), float(sv or 0)
                except (TypeError, ValueError):
                    pass
            if gv != sv:
                diffs.append((f, gv, sv))
        if diffs:
            mismatches.append((k, diffs))

    return {
        'gas_count': len(gas_map),
        'sb_count':  len(sb_map),
        'missing':   missing,
        'extra':     extra,
        'mismatches': mismatches,
    }

# ── הדפסת דוח ─────────────────────────────────────────────────────────────────

W = 56

def hr(c='═'):
    print(c * W)

def print_report(results):
    print()
    hr()
    print('  השוואת נתונים: GAS ↔ Supabase')
    hr()
    print()

    # טבלת סיכום
    header = f"{'טבלה':<18} {'GAS':>5} {'SB':>5} {'חסרים':>7} {'עודפים':>7} {'שונים':>7}"
    print(header)
    print('─' * W)

    total_issues = 0
    for name, r in results.items():
        issues = len(r['missing']) + len(r['extra']) + len(r['mismatches'])
        total_issues += issues
        flag = ' ⚠' if issues else ' ✓'
        print(
            f"{name:<18} {r['gas_count']:>5} {r['sb_count']:>5}"
            f" {len(r['missing']):>7} {len(r['extra']):>7}"
            f" {len(r['mismatches']):>7}{flag}"
        )

    print()
    if total_issues == 0:
        hr()
        print('✅ אין הפרשים — הנתונים זהים בשני מסדי הנתונים')
        hr()
        return

    # פירוט הפרשים
    hr('═')
    print('  פירוט הפרשים')
    hr('═')

    for name, r in results.items():
        sections = []

        if r['missing']:
            sections.append(('חסרים ב-Supabase', r['missing'], None))
        if r['extra']:
            sections.append(('עודפים ב-Supabase (לא ב-GAS)', r['extra'], None))
        if r['mismatches']:
            sections.append(('ערכים שונים', None, r['mismatches']))

        if not sections:
            continue

        print()
        print(f'[{name}]')

        for title, keys, mismatches in sections:
            print(f'  ── {title} ──')
            if keys is not None:
                for k in keys:
                    print(f'    • {k}')
            if mismatches is not None:
                for k, diffs in mismatches:
                    print(f'    • {k}')
                    for field, gv, sv in diffs:
                        print(f'        {field}:')
                        print(f'          GAS: {gv!r}')
                        print(f'          SB:  {sv!r}')

    print()
    hr()
    print(f'  סה"כ: {total_issues} הפרשים נמצאו')
    hr()

# ── ריצה ראשית ────────────────────────────────────────────────────────────────

def run():
    hr()
    print('  שואב נתונים מ-GAS…')
    hr()

    # GAS
    gas_riders_raw  = gas_get('getAllRiders')
    gas_bikes_raw   = gas_get('getBikes')
    gas_events_resp = gas_get('getAllEvents')
    gas_maint_raw   = gas_get('getMaintenance')

    if isinstance(gas_events_resp, dict):
        gas_events_raw = (
            gas_events_resp.get('upcoming', []) +
            gas_events_resp.get('past',     []) +
            gas_events_resp.get('cancelled', [])
        )
    else:
        gas_events_raw = gas_events_resp or []

    gas_regs_raw = []
    for ev in gas_events_raw:
        eid = ev.get('id', '')
        if not eid:
            continue
        try:
            regs = gas_get('getRegistrations', {'eventId': eid})
            if isinstance(regs, list):
                for r in regs:
                    r['eventId'] = eid
                gas_regs_raw.extend(regs)
        except Exception:
            pass

    print()
    hr()
    print('  שואב נתונים מ-Supabase…')
    hr()

    sb_riders = sb_get('riders')
    sb_bikes  = sb_get('bikes')
    sb_events = sb_get('events')
    sb_regs   = sb_get('registrations')
    sb_maint  = sb_get('maintenance')

    # נרמול נתוני Supabase לפורמט אחיד
    for r in sb_riders:
        r['phone'] = norm_phone(r.get('phone', ''))
    for r in sb_regs:
        r['tid']         = str(r.get('tid', ''))
        r['partner_tid'] = str(r.get('partner_tid', ''))
        if not r.get('id'):
            r['id'] = f"{r.get('event_id','')}-{r.get('tid','')}"

    print()
    hr()
    print('  משווה…')
    hr()

    gas_data = {
        'riders':        [map_rider(r)        for r in gas_riders_raw],
        'bikes':         [map_bike(b)          for b in gas_bikes_raw],
        'events':        [map_event(e)         for e in gas_events_raw],
        'registrations': [map_registration(r)  for r in gas_regs_raw],
        'maintenance':   [map_maintenance(m)   for m in gas_maint_raw],
    }
    sb_data = {
        'riders':        sb_riders,
        'bikes':         sb_bikes,
        'events':        sb_events,
        'registrations': sb_regs,
        'maintenance':   sb_maint,
    }

    results = {
        name: compare_table(name, gas_data[name], sb_data[name])
        for name in COMPARE_FIELDS
    }

    print_report(results)

    has_issues = any(
        r['missing'] or r['extra'] or r['mismatches']
        for r in results.values()
    )
    sys.exit(1 if has_issues else 0)

if __name__ == '__main__':
    run()
