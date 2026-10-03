"""Independent oracle for the manual's worked examples.

The expected screens in test/official/examples.json were captured from ASA's
official CX-3 emulator. This script checks those numbers once more against
references that share no code with the simulator or the emulator: aerocalc3
(airspeed, density altitude, standard atmosphere), ambiance (ICAO standard
atmosphere), and plain geometry solved numerically (bisection / quadrature)
rather than with the closed-form formulas the simulator uses.

Run:  pip install -r test/oracle/requirements.txt  &&  python test/oracle/oracle.py
"""
import json
import math
import os
from aerocalc3 import airspeed as AS, std_atm as SA
from ambiance import Atmosphere

FT = 0.3048                 # m, exact
NM = 1852.0                 # m, exact
SM = 1609.344               # m, exact
FT_PER_NM = NM / FT
KT = NM / 3600              # m/s
INHG = 3386.389             # Pa
LB_PER_GAL = {'Av Gas': 6.0, 'Jet Fuel': 6.84}

HERE = os.path.dirname(os.path.abspath(__file__))
EX = {e['id']: e for e in json.load(open(os.path.join(HERE, '..', 'official', 'examples.json')))}
results = []


def shown(ex, label, nth=1):
    """value text the example expects for a row label (nth occurrence)"""
    rows = [r for r in EX[ex]['expect'] if r[0] == label]
    return rows[nth - 1][1]


def num(text):
    """number and decimals of a displayed value; h:m:s → seconds (dp 0)"""
    if ':' in text:
        neg = text.startswith('-')
        p = [float(x) for x in text.lstrip('-').split(':')]
        s = p[0] * 3600 + p[1] * 60 + (p[2] if len(p) > 2 else 0)
        return (-s if neg else s), 0
    dp = len(text.split('.')[1]) if '.' in text else 0
    return float(text), dp


def check(ex, label, oracle_value, nth=1):
    """pass when the oracle rounds to the number shown; h:m:s values are
    shown with the seconds truncated, so there the oracle may be up to 1 s more."""
    text = shown(ex, label, nth)
    val, dp = num(text)
    if ':' in text:
        ok = -1e-6 <= oracle_value - val < 1 + 1e-6
    else:
        ok = abs(oracle_value - val) <= 0.5 * 10 ** (-dp) + 1e-9
    results.append((ok, ex, label, text, round(oracle_value, dp + 3)))


def check_text(ex, label, want, nth=1):
    text = shown(ex, label, nth)
    results.append((text == want, ex, label, text, want))


def f2c(f): return (f - 32) / 1.8
def c2f(c): return c * 1.8 + 32
def wrap360(a): return a % 360
def hms(sec): return sec


def bisect(f, lo, hi, n=200):
    flo = f(lo)
    for _ in range(n):
        mid = (lo + hi) / 2
        fm = f(mid)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2


# ---------------------------------------------------------------- conversions
check('E01', 'Dist', 100 * NM / SM)
check_text('E01b', 'Temp', '%d' % round(f2c(59)))
check('E01b', 'Angle', 45 + 30 / 60)

# ---------------------------------------------------------------- altitude
pa = 5000 + SA.press2alt(30.12, press_units='in HG', alt_units='ft')
check('E02', 'PAlt', pa)
check('E02', 'DAlt', SA.density_alt(pa, f2c(77), alt_units='ft', temp_units='C'))
# OAT that gives density altitude 8500 ft at pressure altitude 6000 ft
t = bisect(lambda c: SA.density_alt(6000, c, alt_units='ft', temp_units='C') - 8500, -60, 60)
check('E03', 'OAT', c2f(t))

# Cloud base: the CX-3 uses a 2.444 °C (4.4 °F) spread per 1,000 ft
check('E04', 'AGL', (f2c(72) - f2c(57)) / 2.444444 * 1000)

# Standard atmosphere (ICAO, ambiance). Pressure altitude is geopotential;
# ambiance takes geometric height, so convert (r0 = 6,356,766 m).
R0 = 6356766.0
def atm(h_ft):
    H = h_ft * FT
    return Atmosphere(R0 * H / (R0 - H))
check('E05', 'Baro', atm(10000).pressure[0] / INHG)
check('E05', 'OAT', c2f(atm(10000).temperature_in_celsius[0]))
check('E06', 'Alt', SA.press2alt(20.58, press_units='in HG', alt_units='ft'))

# ---------------------------------------------------------------- airspeed
oat = f2c(41)
m = AS.cas_alt2mach(135, 8000, speed_units='kt', alt_units='ft')
check('E07', 'MACH', m)
check('E07', 'TAS', AS.cas2tas(135, 8000, temp=oat, speed_units='kt', alt_units='ft', temp_units='C'))
check('E07', 'TAT', c2f((oat + 273.15) * (1 + 0.2 * m * m) - 273.15))

m = AS.cas_alt2mach(250, 25000, speed_units='kt', alt_units='ft')
oat_k = (f2c(4) + 273.15) / (1 + 0.2 * m * m)        # probe recovery factor K = 1
check('E08', 'MACH', m)
check('E08', 'OAT', c2f(oat_k - 273.15))
check('E08', 'TAS', m * math.sqrt(1.4 * 287.05287 * oat_k) / KT)

check('E09', 'TAS', 0.78 * math.sqrt(1.4 * 287.05287 * (f2c(-65) + 273.15)) / KT)
check('E09', 'CAS', AS.mach_alt2cas(0.78, 35000, speed_units='kt', alt_units='ft'))
check('E09', 'TAT', c2f((f2c(-65) + 273.15) * (1 + 0.2 * 0.78 ** 2) - 273.15))

# ---------------------------------------------------------------- fuel
check('E10', 'Vol', 2.5 * 9.5)
check('E10', 'Wt', 2.5 * 9.5 * LB_PER_GAL['Av Gas'])
check('E10', 'Rate', 9.5 * LB_PER_GAL['Av Gas'], nth=2)
check('E11', 'Wt', 2.5 * 9.5 * LB_PER_GAL['Jet Fuel'])
check('E11', 'Rate', 9.5 * LB_PER_GAL['Jet Fuel'], nth=2)

# ---------------------------------------------------------------- time, speed, distance
check('E12', 'GS', 150 / 1.25)
check('E12', 'Dur', 1.25 * 3600)
check('E13', 'Dur', 210 / 140)
check('E14', 'Dist', 9 * 5000 / FT_PER_NM)
check('E15', 'AoC/D', 6000 / 30)
check('E15', 'RoC/D', 120 * (6000 / 30) / 60)
check('E15', 'Rat', 30 * FT_PER_NM / 6000)
check('E16', 'RoC/D', 90 * 318 / 60)
check('E19', 'ETA', (14.5 + 2.25) * 3600)
check('E20', 'ETA', (22.75 + 3 - 24) * 3600)

# ---------------------------------------------------------------- wind
def comp(wspd, wdir, rwy_deg):
    """cross (+ from the right) and head (+ on the nose) by projecting the wind vector"""
    # unit vectors: along the runway and to its right
    a = math.radians(rwy_deg)
    along = (math.sin(a), math.cos(a)); right = (math.cos(a), -math.sin(a))
    w = (-wspd * math.sin(math.radians(wdir)), -wspd * math.cos(math.radians(wdir)))   # air moving toward
    head = -(w[0] * along[0] + w[1] * along[1])
    cross = -(w[0] * right[0] + w[1] * right[1])
    return cross, head
x, h = comp(20, 330, 360)
check('E17', 'X Wnd', x); check('E17', 'H Wnd', h)
x, h = comp(12, 120, 270)
check('E18', 'X Wnd', x); check('E18', 'H Wnd', h)

def vec(spd, toward_deg):
    r = math.radians(toward_deg)
    return (spd * math.sin(r), spd * math.cos(r))

def ground(tas, hdg, wspd, wdir):
    a, w = vec(tas, hdg), vec(wspd, wdir + 180)
    return (a[0] + w[0], a[1] + w[1])

def solve_heading(tc, tas, wspd, wdir):
    """heading whose ground track is tc, by bisection on the cross-track error"""
    def err(h):
        g = ground(tas, h, wspd, wdir)
        d = math.degrees(math.atan2(g[0], g[1])) - tc
        return (d + 180) % 360 - 180
    return bisect(err, tc - 60, tc + 60) % 360

th = solve_heading(90, 128, 15, 210)
g = ground(128, th, 15, 210)
check('E23', 'THdg', th)
check('E23', 'GS', math.hypot(*g))
check('E23', 'WCA', th - 90)
# find the wind: ground vector minus air vector
gv, av = vec(140, 90), vec(128, 95)
w = (gv[0] - av[0], gv[1] - av[1])
check('E24', 'WSpd', math.hypot(*w))
check('E24', 'WDir', wrap360(math.degrees(math.atan2(w[0], w[1])) + 180))
# TAS for a ground speed: bisection on TAS
th = None
def gs_err(tas):
    global th
    th = solve_heading(270, tas, 25, 310)
    return math.hypot(*ground(tas, th, 25, 310)) - 150
tas = bisect(gs_err, 100, 300)
check('E25', 'TAS', tas)
check('E25', 'THdg', th)

check('E21', 'To', wrap360(45 + 180))
check('E22', 'MHdg', 96 - 12)       # variation: west +, east −
check('E22', 'CHdg', 96 - 12 + 2)

# ---------------------------------------------------------------- rhumb line
# A loxodrome crosses every meridian at the same angle; integrate its length
# numerically. The CX-3 counts one minute of arc as one nautical mile.
R = 60 * 180 / math.pi              # NM per radian
def mercator(lat): return math.log(math.tan(math.pi / 4 + lat / 2))
def rhumb(lat1, lon1w, lat2, lon2w):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlon_east = math.radians(((lon1w - lon2w) + 180) % 360 - 180)
    crs = math.atan2(dlon_east, mercator(p2) - mercator(p1))
    n = 20000
    dist = 0.0
    for i in range(n):            # length = ∫ dφ / cos(course) — or ∫ cos φ dλ / sin(course) along an E-W line
        a = p1 + (p2 - p1) * i / n
        b = p1 + (p2 - p1) * (i + 1) / n
        dist += abs(b - a) / abs(math.cos(crs))
    return math.degrees(crs) % 360, dist * R
crs, d = rhumb(40 + 38 / 60, 73 + 47 / 60, 33 + 56 / 60, 118.4)
check('E26', 'TCrs', crs)
check('E26', 'Dist', d)
# point C: 100 NM due west from B along the parallel 33°56′
lat_b = 33 + 56 / 60
check('E26b', 'Long', (118.4 + 100 / (60 * math.cos(math.radians(lat_b)))) * 3600, nth=3)

# ---------------------------------------------------------------- holding (AIM 5-3-8)
def entry(heading, radial, right=True):
    inbound = (radial + 180) % 360
    d = (heading - inbound + 360) % 360          # aircraft heading relative to the inbound course
    if not right:
        d = (360 - d) % 360                      # mirror image for left turns
    if d <= 110 or d >= 290:
        return 'Direct'
    return 'Teardrop' if d <= 180 else 'Parallel'
check_text('E27', 'Entry', entry(90, 360, True))
check_text('E28', 'Entry', entry(90, 360, False))

# ---------------------------------------------------------------- trip plan
def leg(tc, dist, tas, wdir, wspd, var, dev, rate):
    h = solve_heading(tc, tas, wspd, wdir)
    gs = math.hypot(*ground(tas, h, wspd, wdir))
    ete = dist / gs
    return dict(gs=gs, th=h, mh=h + var, ch=h + var + dev, ete=ete * 3600, fuel=rate * ete)
l1 = leg(90, 100, 120, 270, 20, 5, 2, 9)
check('E29', 'GS', l1['gs']); check('E29', 'TH', l1['th']); check('E29', 'MH', l1['mh']); check('E29', 'CH', l1['ch'])
check('E29', 'Fuel', l1['fuel']); check('E29', 'ETE', l1['ete']); check('E29', 'ETA', 12 * 3600 + l1['ete'])
l2 = leg(180, 85, 120, 270, 20, 5, 2, 9)
check('E30', 'Dist', 100 + 85)
check('E30', 'ETE', l1['ete'] + l2['ete'])
check('E30', 'Fuel', l1['fuel'] + l2['fuel'])

# ---------------------------------------------------------------- weight and balance
items = [(1500, 40), (170, 37), (30, 48)]
check('E31', 'Wt', sum(w for w, a in items), nth=4)
check('E31', 'Mom', sum(w * a for w, a in items), nth=4)
check('E31', 'CG', sum(w * a for w, a in items) / sum(w for w, a in items))
items = [(1500, 40), (30, 48)]
check('E32', 'CG', sum(w * a for w, a in items) / sum(w for w, a in items))
check('E33', '∆CG', 50 * 100 / 2500)
check('E34', '%MAC', (910.2 - 860.2) / 180.7 * 100)

# ---------------------------------------------------------------- report
bad = [r for r in results if not r[0]]
for ok, ex, label, text, val in results:
    print(('ok  ' if ok else 'FAIL'), ex, label, 'shown', text, 'oracle', val)
print('%d/%d expected values agree with the independent oracle' % (len(results) - len(bad), len(results)))
raise SystemExit(1 if bad else 0)
