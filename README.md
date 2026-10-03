# CX-3 Flight Computer — browser simulator

A browser simulation of the ASA CX-3 electronic flight computer (E6-B), with the same
key layout, menu structure and on-screen workflow as the handheld unit. It is plain
HTML/CSS/JS with no build step and no dependencies.

## Live site

**https://bighorse.github.io/e6b/** (GitHub Pages, updated on every push)

## Run

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Keys

The keypad follows the real unit: 5 columns × 7 rows.

```
 FLT    PLAN    ▲     TIMER   CALC
 BACK    ★      ■     W/B     SET
 M     SET UNIT ▼   CONV UNIT  ÷
 C       7      8      9       ×
 BKSP    4      5      6       −
 :       1      2      3       +
 ±       ·      0      √       =
```

| Key | Action |
| --- | --- |
| **FLT / W/B** | Flight and E6-B (weight & balance) menus |
| **PLAN / TIMER / CALC** | Flight plan, timer, calculator |
| **▲ ▼** | Move the selection |
| **■ (orange)** | ON / ENTER. Hold 3 s to turn off |
| **BACK** | Previous screen, or cancel the current entry |
| **C / BKSP** | Clear the entry or field / delete the last character |
| **SET UNIT** | Change the unit of the selected value (the number stays) |
| **CONV UNIT** | Convert the selected value to the next unit (opens Unit Conversions elsewhere) |
| **★** | Open your favorite function (choose it in SET › Favorite) |
| **M** | Memory M0–M9: ENTER recalls, M stores, C clears |
| **SET** | Theme (Dark / Night / Day), Backlighting, Time Set (Zulu), Default Units, Unit Changes, Favorite, Aircraft Profile, User Data, Key Click, Auto Off, Version |
| **:** | Time / angle separator (`1:30` = 1 h 30 min, `40:30` = 40°30′) |

Input lines accept arithmetic (`120+15`, then ENTER). On a computer keyboard: digits,
`+ - * /`, Enter, Esc = BACK, Del = C, Backspace = BKSP, ↑ ↓, and the letters
F, P, T, C, W, S, M, A (★), U (SET UNIT), V (CONV UNIT), N (±), R (√).

## Functions

- **FLT**
  - Altitude: Pressure Altitude, Density Altitude, Cloud Base, Standard Atmosphere
  - Airspeed: Planned TAS (OAT), Actual TAS (TAT), Mach Number
  - Fuel: Fuel Burn, Fuel Rate, Endurance, Fuel Weight
  - Ground Speed, Time, Distance, Estimated Time of Arrival
  - Compass Heading (wind triangle, variation and deviation), Wind Correction (enter any
    four of GS, TAS, TCrs, THdg, WSpd, WDir and the other two are solved, as on the CX-3),
    Wind Component, To-From, Rhumb Line
  - Climb & Descent: Climb/Descent, Top of Descent, Required Rate
  - Glide, Holding Pattern (entry type and wind-corrected headings)
  - Unit Conversions (12 categories): distance, speed, duration, temperature, pressure,
    volume, rate, weight, rate of climb, angle of climb, torque, angle
- **PLAN**: flight plan, listed by leg (LEG 1, LEG 2 … Add, TOTALS; up to 20 legs). TAS,
  wind, variation and fuel rate carry over from earlier legs or the Aircraft Profile.
- **TIMER**: count up / count down (type HHMMSS) with Start, Restart, Reset, and an alarm
- **CALC**: algebraic calculator (× ÷ before + −) with √, ±, a history tape (▲▼ to pick a line,
  ENTER to reuse it) and h:m:s time arithmetic. After "=", an operator continues from the result
  at full precision (shown as `Ans`). Time ± time and time × or ÷ a number give a time;
  time ÷ time gives a plain number. C clears the line, a second C clears the history.
- **W/B (E6-B)**: weight & balance listed by item (RF, ITEM 1 … Add, TOTALS), weight shift
  (leave one value blank to solve for it), weight add/remove, % MAC

The case, keypad, screen colors and layout follow photos of the real unit.
Data, settings, favorites and memories are saved in the browser's local storage.

## Tests

```sh
node --test test/*.test.js                      # unit tests, incl. 5,000 random CALC expressions vs exact arithmetic
pip install -r test/oracle/requirements.txt && python test/oracle/oracle.py   # manual values vs independent references
npm i playwright && npx playwright install chromium
node test/e2e/docvals.js                        # manual examples typed on the simulator
node test/e2e/calc.e2e.js                       # CALC screen, on-screen keys and keyboard
```

All of these run on every push (GitHub Actions: Verify accuracy).

The calculations use the ICAO standard atmosphere, compressible-flow airspeed
equations, and AIM 5-3-8 holding entry sectors.

## Deploy to a Baidu Cloud (百度智能云) BCC server

1. **Prepare the server once.** Upload `deploy/setup-server.sh`, then run
   `sudo bash setup-server.sh`. It installs nginx and rsync, and serves `/var/www/cx3`.
   In the BCC console, open inbound **TCP 80** (and 22) in the instance's security group.
2. **Deploy**, in either of two ways:
   - **GitHub Actions (automatic):** add these repository secrets under
     *Settings → Secrets and variables → Actions*:
     - `DEPLOY_HOST`: the server's public IP
     - `DEPLOY_SSH_KEY`: a private key whose public key is in the server's `~/.ssh/authorized_keys`
     - Optional: `DEPLOY_USER` (default `root`), `DEPLOY_PORT` (default `22`),
       `DEPLOY_PATH` (default `/var/www/cx3`)

     Every push to `main`/`master`/`feature/cx3-flight-computer` then runs the tests and uploads
     the site. You can also start it by hand from the Actions tab (*Run workflow*).
   - **From your own machine:** `DEPLOY_HOST=<ip> deploy/deploy.sh`
3. Open `http://<server-ip>/`. To use a domain on a mainland China server, the domain
   needs ICP filing (备案) first. Then set `server_name` in nginx and add HTTPS.
