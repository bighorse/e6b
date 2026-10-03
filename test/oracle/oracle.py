"""Independent oracle for the CX-3 manual / test-plan expected values.

Nothing here imports the app's JavaScript. Physics comes from third-party
libraries (aerocalc3: airspeed / density altitude / std atmosphere;
ambiance: ICAO 1993 standard atmosphere); geometry is solved numerically
(bisection / quadrature) instead of the app's closed-form formulas; unit
conversions use exact international definitions.

Run:  pip install aerocalc3 ambiance  &&  python test/oracle/oracle.py
"""
import math
from aerocalc3 import airspeed as AS, std_atm as SA
from ambiance import Atmosphere

FT = 0.3048                 # m, exact
NM = 1852.0                 # m, exact
FT_PER_NM = NM / FT
KT = NM / 3600              # m/s
INHG = 3386.389             # Pa
R_EARTH_NM = 3440.065       # mean earth radius used for spherical navigation

results = []

def check(case, name, expected_shown, oracle_value, dp, tol_units=0.5):
    """expected_shown: the value printed in the doc; pass if the oracle,
    rounded to the same decimals, is within tol_units of the last digit."""
    step = 10 ** (-dp)
    ok = abs(oracle_value - expected_shown) <= tol_units * step + 1e-9
    results.append((ok, case, name, expected_shown, round(oracle_value, dp + 2)))

def hms(h):
    t = round(h * 3600)
    return t  # seconds

# ---------------------------------------------------------------- altitude
# Pressure altitude: altitude in the standard atmosphere of the altimeter setting
pa = 5000 + SA.press2alt(30.12, press_units='in HG', alt_units='ft')
check('§4', 'PAlt (5000 ft, 30.12)', 4817, pa, 0)
for oat, shown in [(25, 7262), (15, 6150), (-15, 2505)]:
    check('§4/T03', f'DAlt (PA 5000, OAT {oat})', shown,
          SA.density_alt(5000, oat, alt_units='ft', temp_units='C'), 0)
# PAlt 5000 m (SET UNIT case) = 16404.2 ft
check('T04', 'DAlt (PA 5000 m, OAT 25)', 20984,
      SA.density_alt(5000 / FT, 25, alt_units='ft', temp_units='C'), 0)
check('T04', 'DAlt 7262 ft in m', 2213, 7262 * FT, 0)

# Cloud base: FAA PHAK rule, spread / 2.5 °C per 1,000 ft
check('§4', 'Cloud base AGL', 3200, (22 - 14) / 2.5 * 1000, 0)

# Standard atmosphere at 10,000 ft (ICAO 1993, ambiance). Pressure altitude is
# geopotential; ambiance takes geometric height, so convert (r0 = 6,356,766 m).
R0 = 6356766.0
H = 10000 * FT
atm = Atmosphere(R0 * H / (R0 - H))
check('§4', 'ISA temp 10000 ft', -4.8, atm.temperature_in_celsius[0], 1)
check('§4', 'ISA press 10000 ft (inHg)', 20.58, atm.pressure[0] / INHG, 2)
check('§4', 'ISA density ratio 10000 ft', 0.7385, atm.density[0] / Atmosphere(0).density[0], 4)
check('§4', 'ISA speed of sound 10000 ft (kt)', 638, atm.speed_of_sound[0] / KT, 0)

# ---------------------------------------------------------------- airspeed
tas = AS.cas2tas(150, 8000, temp=0, speed_units='kt', alt_units='ft', temp_units='C')
check('§4', 'Planned TAS', 169, tas, 0)
check('§4', 'Planned TAS Mach', 0.263, AS.tas2mach(tas, 0, speed_units='kt', temp_units='C'), 3)
check('§4', 'Planned TAS DAlt', 8101, SA.density_alt(8000, 0, alt_units='ft', temp_units='C'), 0)
m = AS.cas_alt2mach(250, 35000, speed_units='kt', alt_units='ft')
oat_k = (-30 + 273.15) / (1 + 0.2 * m * m)          # TAT -> static temperature, recovery factor 1
check('§4', 'Actual TAS Mach', 0.741, m, 3)
check('§4', 'Actual TAS OAT', -54.1, oat_k - 273.15, 1)
check('§4', 'Actual TAS', 428, AS.mach2tas(m, oat_k - 273.15, speed_units='kt', temp_units='C'), 0)
check('§4', 'Mach (OAT -40, TAS 450)', 0.756, AS.tas2mach(450, -40, speed_units='kt', temp_units='C'), 3)
check('§4', 'Speed of sound at -40 °C (kt)', 595, AS.mach2tas(1, -40, speed_units='kt', temp_units='C'), 0)

# ---------------------------------------------------------------- fuel / time / distance (arithmetic)
check('§4', 'Fuel burn 9.5 gal/h × 2:15', 21.4, 9.5 * 2.25, 1)
check('§4', 'Fuel rate 30 gal / 3:20', 9.0, 30 / (3 + 20 / 60), 1)
check('§4', 'Endurance 48/8.5 (s)', 5 * 3600 + 38 * 60 + 49, hms(48 / 8.5), 0)
check('§4', 'AvGas 40 gal (6.0 lb/gal)', 240.0, 40 * 6.0, 1)
check('§4', 'Jet A 40 gal (6.7 lb/gal)', 268.0, 40 * 6.7, 1)
check('T09', 'Oil 40 gal (7.5 lb/gal)', 300.0, 40 * 7.5, 1)
check('§4', 'GS 150 nm / 1:15', 120, 150 / 1.25, 0)
check('§4', 'Time 210/140 (s)', 5400, hms(210 / 140), 0)
check('§4', 'Distance 125 kt × 0:48', 100.0, 125 * 0.8, 1)
check('T08', 'ETA 23:59 + 100/120 h (min of day)', 49, ((23 * 60 + 59) + 100 / 120 * 60) % 1440, 0)

# ---------------------------------------------------------------- wind triangle (numerical)
def vec(spd, toward_deg):
    a = math.radians(toward_deg)
    return complex(spd * math.sin(a), spd * math.cos(a))   # x = east, y = north

def solve_heading(tc, tas, wdir, wspd):
    """Find heading whose air+wind vector points along tc (bisection on the cross-track error)."""
    w = vec(wspd, wdir + 180)
    def err(h):
        g = vec(tas, h) + w
        return math.degrees(math.atan2(g.real, g.imag)) - tc
    lo, hi = tc - 89, tc + 89
    def wrap(x): return (x + 180) % 360 - 180
    for _ in range(200):
        mid = (lo + hi) / 2
        if wrap(err(lo)) * wrap(err(mid)) <= 0: hi = mid
        else: lo = mid
    h = (lo + hi) / 2
    return h % 360, abs(vec(tas, h) + w)

h, gs = solve_heading(90, 120, 45, 20)
check('§4/T06', 'WCA (L) 090/120 wind 045/20', 6.8, 90 - h, 1)
check('§4/T06', 'THdg', 83, h, 0)
check('§4/T06', 'MHdg (Var 10 W)', 93, h + 10, 0)
check('§4', 'CHdg (Dev -2)', 91, h + 10 - 2, 0)
check('T06', 'MHdg (Var 10 E)', 73, h - 10, 0)
check('§4/T06', 'GS', 105, gs, 0)
# unknown wind from rounded inputs GS 105 / TAS 120 / TC 090 / TH 083
wv = vec(105, 90) - vec(120, 83)            # wind vector, blowing toward
check('§4', 'Unknown wind speed', 20, abs(wv), 0)
check('§4', 'Unknown wind from', 44, (math.degrees(math.atan2(wv.real, wv.imag)) + 180) % 360, 0)
# wind components
# 15 kt at 30° = exactly 7.5 kt crosswind: the display must round half up to 8
for rwy, wd, ws, head, cross in [(270, 300, 20, 17, 10), (270, 120, 15, -13, -8)]:
    a = math.radians(wd - rwy)
    check('§4', f'Head/tail {rwy} {wd}/{ws}', head, ws * math.cos(a), 0)
    check('§4', f'Cross {rwy} {wd}/{ws}', cross, ws * math.sin(a), 0)

# ---------------------------------------------------------------- rhumb line (numerical quadrature)
def rhumb(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(((lon2 - lon1 + 180) % 360) - 180)
    n = 20000                                      # ∫ sec φ dφ by Simpson's rule
    hstep = (p2 - p1) / n
    s = sum((1 if i in (0, n) else 4 if i % 2 else 2) / math.cos(p1 + i * hstep) for i in range(n + 1))
    merid = s * hstep / 3                          # meridional parts (isometric latitude difference)
    crs = math.atan2(dl, merid)
    dist = abs(p2 - p1) / abs(math.cos(crs)) * R_EARTH_NM
    return math.degrees(crs) % 360, dist

c, d = rhumb(40 + 38 / 60, -(73 + 47 / 60), 51 + 28 / 60, -27 / 60)
check('§4', 'Rhumb JFK-LHR course', 78, c, 0)
check('§4', 'Rhumb JFK-LHR distance', 3110.2, d, 1)

# ---------------------------------------------------------------- climb / descent / glide
check('§4', 'Climb time 10 nm @ 90 kt (s)', 400, hms(10 / 90), 0)
check('§4', 'Climb rate 3000 ft in 6:40', 450, 3000 / (10 / 90 * 60), 0)
check('§4', 'Gradient ft/nm', 300, 3000 / 10, 0)
check('§4', 'Climb angle', 2.8, math.degrees(math.atan2(3000 * FT, 10 * NM)), 1)
check('§4', 'TOD time (s)', 960, hms(8000 / 500 / 60), 0)
check('§4', 'TOD distance', 40.0, 150 * 8000 / 500 / 60, 1)
check('§4', 'Required rate (FAA: ft/nm × GS/60)', 636, 318 * 120 / 60, 0)
check('§4', 'Glide distance', 8.9, 6000 * 9 * FT / NM, 1)
t = 6000 * 9 * FT / NM / 65
check('§4', 'Glide time (s)', 8 * 60 + 12, hms(t), 0)
check('§4', 'Sink rate', 731, 6000 / (t * 60), 0)

# ---------------------------------------------------------------- holding (wind part)
h_in, _ = solve_heading(360, 120, 270, 20)
wca = (h_in + 180) % 360 - 180
check('§4/T10', 'Hold inbound heading', 350, h_in, 0)
check('§4/T10', 'Hold WCA (L)', 9.6, -wca, 1)
check('§4/T10', 'Hold outbound (3× WCA)', 209, (180 - 3 * wca) % 360, 0)
check('§4', 'Teardrop R (150 - 3×WCA)', 179, (150 - 3 * wca) % 360, 0)
check('T10', 'Teardrop L (210 - 3×WCA)', 239, (210 - 3 * wca) % 360, 0)

# ---------------------------------------------------------------- flight plan
def leg(tc, dist, tas, wdir, wspd, var, rate):
    hd, g = solve_heading(tc, tas, wdir, wspd)
    ete = dist / g
    return hd, hd + var, g, ete, rate * ete
l1 = leg(90, 120, 110, 360, 15, 5, 8.5)
l2 = leg(180, 45, 110, 360, 15, 5, 8.5)
for i, (name, shown, dp) in enumerate([('THdg', 82, 0), ('MHdg', 87, 0), ('GS', 109, 0)]):
    check('§4/T13', 'LEG1 ' + name, shown, l1[i], dp)
check('§4/T13', 'LEG1 ETE (s)', 3964, hms(l1[3]), 0)
check('§4/T13', 'LEG1 fuel', 9.4, l1[4], 1)
check('§4/T13', 'LEG2 GS', 125, l2[2], 0)
check('§4/T13', 'LEG2 ETE (s)', 1296, hms(l2[3]), 0)
check('§4/T13', 'LEG2 fuel', 3.1, l2[4], 1)
check('§4/T13', 'Total ETE (s)', 5260, hms(l1[3] + l2[3]), 0)
check('§4/T13', 'Total fuel', 12.4, l1[4] + l2[4], 1)
check('T13', 'LEG2 GS with TAS 130', 145, leg(180, 45, 130, 360, 15, 5, 8.5)[2], 0)

# ---------------------------------------------------------------- W/B (arithmetic)
check('§4/T12', 'Mom item 1', 127500.0, 1500 * 85, 1)
check('§4/T12', 'CG', 85.51, (1500 * 85 + 170 * 90) / 1670, 2)
check('T12', 'Mom item 1 RF 100', 1275.0, 1500 * 85 / 100, 1)
check('T12', 'Total mom RF 100', 1428.0, (1500 * 85 + 170 * 90) / 100, 1)
check('§4', 'Weight shift CG change', 1.46, 50 * 70 / 2400, 2)
check('§4', 'Weight to shift for 1.5 in', 51.4, 2400 * 1.5 / 70, 1)
check('§4', 'Add 40 lb @120: new CG', 88.57, (2200 * 88 + 40 * 120) / 2240, 2)
check('§4', 'Remove 40 lb @120: new CG', 87.41, (2200 * 88 - 40 * 120) / 2160, 2)
check('§4', '%MAC', 20.0, (30 - 20) / 50 * 100, 1)
check('§4', 'Profile endurance (s)', 5 * 3600 + 52 * 60 + 56, hms(50 / 8.5), 0)
check('§4', 'Profile range', 676.5, 50 / 8.5 * 115, 1)

# ---------------------------------------------------------------- unit conversions (exact definitions)
check('§4/T04', '25 °C in °F', 77.0, 25 * 9 / 5 + 32, 1)
check('§4/T04', '25 °C in K', 298.2, 25 + 273.15, 1)
check('§4', '100 °C in °F', 212.0, 212, 1)
check('§4', '100 nm in sm', 115.1, 100 * NM / 1609.344, 1)
check('§4', '100 nm in km', 185.2, 100 * NM / 1000, 1)

# ---------------------------------------------------------------- report
bad = [r for r in results if not r[0]]
for ok, case, name, shown, val in results:
    print(('PASS ' if ok else 'FAIL ') + f'{case:7} {name:40} doc={shown!s:>10}  oracle={val}')
print(f'\n{len(results) - len(bad)}/{len(results)} expected values confirmed independently')
raise SystemExit(1 if bad else 0)
