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

| Key | Action |
| --- | --- |
| **FLT / PLAN / TIMER / CALC / W/B** | Jump to that main menu |
| **▲ ▼** | Move the selection |
| **◀ ▶** | Change units for the selected value (or toggle option / item / E-W, N-S) |
| **ON/OFF ENTER** | Turn on, open the item, accept the entry. Hold 3 s to turn off |
| **BACK** | Previous screen, or cancel the current entry |
| **CLR** | Cancel the entry, or clear the selected input |
| **SET** | Preferences: backlight, theme, clock, time format, units, decimals, key click, auto-off |
| **M** | In a function: save it to (or remove it from) Favorites. Elsewhere: open Favorites |
| **STO / RCL + 0–9** | Store a value in, or recall it from, memories M0–M9 |
| **:** | Time / angle separator (`1:30` = 1 h 30 min, `40:30` = 40°30′) |

Input lines accept arithmetic (`120+15`, then ENTER). On a computer keyboard: digits,
`+ - * /`, Enter, Esc = BACK, Del = CLR, Backspace = ◀, arrows, and the letters
F, P, T, C, W, S, M, K (STO), R (RCL), N (+/−).

## Functions

- **FLT**
  - Altitude: Pressure Altitude, Density Altitude, Cloud Base, Standard Atmosphere
  - Airspeed: Planned TAS (OAT), Actual TAS (TAT), Mach Number
  - Fuel: Fuel Burn, Fuel Rate, Endurance, Fuel Weight
  - Ground Speed, Time, Distance, Estimated Time of Arrival
  - Compass Heading (wind triangle, variation and deviation), Wind Correction (unknown
    wind), Wind Component, To-From, Rhumb Line
  - Climb & Descent: Climb/Descent, Top of Descent, Required Rate
  - Glide, Holding Pattern (entry type and wind-corrected headings)
  - Unit Conversions (12 categories): distance, speed, duration, temperature, pressure,
    volume, rate, weight, rate of climb, angle of climb, torque, angle
- **PLAN**: multi-leg flight plan (20 legs). TAS, wind, variation and fuel rate carry over
  from earlier legs. Shows per-leg and total distance, time and fuel.
- **TIMER**: stopwatch with laps, countdown timer with alarm, local/UTC clock
- **CALC**: algebraic calculator with history tape and h:m:s time arithmetic
- **W/B**: weight & balance (20 items, reduction factor), weight shift (leave one value
  blank to solve for it), weight add/remove, % MAC

Data, settings, favorites and memories are saved in the browser's local storage.

## Tests

```sh
node --test test/*.test.js
```

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
