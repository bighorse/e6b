/* Checks that every worked example in the user manual (section 4) shows exactly
 * the documented value on the simulator's screen, entering inputs key by key.
 * Run: npm i playwright && npx playwright install chromium && node test/e2e/docvals.js
 * The expected values themselves are confirmed independently by test/oracle/oracle.py. */
const { chromium } = require('playwright');
// Each example: menu path (FLT indices or W/B), inputs [label, keys], expected [label, value, unit]
const F = (...p) => ['FLT', ...p], W = (...p) => ['W/B', ...p];
const EX = [
  ['PAlt', F(0,0), [['Ind Alt','5000'],['Baro','30.12']], [['PAlt','4,817','FT']]],
  ['DAlt', F(0,1), [['PAlt','5000'],['OAT','25']], [['DAlt','7,262','FT']]],
  ['Cloud', F(0,2), [['Temp','22'],['Dew Pt','14'],['Elev','1200']], [['Base AGL','3,200','FT'],['Base MSL','4,400','FT']]],
  ['StdAtm', F(0,3), [['Alt','10000']], [['Temp','-4.8','°C'],['Press','20.58','INHG'],['Dens Ratio','0.7385',''],['Sp Sound','638','KTS']]],
  ['PTAS', F(1,0), [['PAlt','8000'],['OAT','0'],['CAS','150']], [['TAS','169','KTS'],['Mach','0.263',''],['DAlt','8,101','FT']]],
  ['ATAS', F(1,1), [['PAlt','35000'],['TAT','30±'],['CAS','250']], [['TAS','428','KTS'],['Mach','0.741',''],['OAT','-54.1','°C']]],
  ['Mach', F(1,2), [['OAT','40±'],['TAS','450']], [['Mach','0.756',''],['Sp Sound','595','KTS']]],
  ['FBurn', F(2,0), [['Rate','9.5'],['Time','2:15']], [['Fuel','21.4','GAL']]],
  ['FRate', F(2,1), [['Fuel','30'],['Time','3:20']], [['Rate','9.0','GAL/HR']]],
  ['Endur', F(2,2), [['Fuel','48'],['Rate','8.5']], [['Time','5:38:49','']]],
  ['FWt', F(2,3), [['Fuel','40']], [['Weight','240.0','LBS']]],
  ['GS', F(3), [['Dist','150'],['Time','1:15']], [['GS','120','KTS']]],
  ['Time', F(4), [['Dist','210'],['GS','140']], [['Time','1:30:00','']]],
  ['Dist', F(5), [['GS','125'],['Time',':48']], [['Dist','100.0','NM']]],
  ['ETA', F(6), [['Dist','180'],['GS','120'],['Dep Time','1430']], [['ETE','1:30:00',''],['ETA','16:00','']]],
  ['CmpHdg', F(7), [['TCrs','90'],['TAS','120'],['WDir','45'],['WSpd','20'],['Var','10'],['Dev','2±']],
     [['WCA','6.8° L',''],['THdg','083°',''],['MHdg','093°',''],['CHdg','091°',''],['GS','105','KTS']]],
  ['WCorr', F(8), [['GS','105'],['TAS','120'],['TCrs','90'],['THdg','83']], [['WSpd','20','KTS'],['WDir','044°',''],['WCA','7.0° L','']]],
  ['WComp1', F(9), [['Rwy','27'],['WDir','300'],['WSpd','20']], [['Headwind','17','KTS'],['X-Wind R','10','KTS']]],
  ['WComp2', F(9), [['Rwy','27'],['WDir','120'],['WSpd','15']], [['Tailwind','13','KTS'],['X-Wind L','8','KTS']]],
  ['ToFrom', F(10), [['Radial','60']], [['Crs To','240°','']]],
  ['Rhumb', F(11), [['Lat 1','40:38'],['Long 1','73:47±'],['Lat 2','51:28'],['Long 2','0:27±']], [['TCrs','078°',''],['Dist','3,110.2','NM']]],
  ['Climb', F(12,0), [['Alt Chg','3000'],['GS','90'],['Dist','10']], [['Time','0:06:40',''],['Rate','450','FT/MIN'],['Gradient','300','FT/NM'],['Angle','2.8','DEG']]],
  ['TOD', F(12,1), [['Cur Alt','9500'],['Tgt Alt','1500'],['GS','150'],['Rate','500']], [['Time','0:16:00',''],['Dist','40.0','NM'],['Gradient','200','FT/NM']]],
  ['ReqRate', F(12,2), [['GS','120'],['Gradient','318']], [['Rate','636','FT/MIN']]],
  ['Glide', F(13), [['Height','6000'],['Glide Ratio','9'],['GS','65']], [['Dist','8.9','NM'],['Time','0:08:12',''],['Sink Rate','731','FT/MIN']]],
  ['Hold', F(14), [['Inbd Crs','360'],['Hdg to Fix','150'],['TAS','120'],['WDir','270'],['WSpd','20']],
     [['Entry','Teardrop',''],['Inbd Hdg','350°',''],['Outbd Hdg','209°',''],['Tear Hdg','179°',''],['WCA','9.6° L','']]],
  ['WShift', W(1), [['Tot Wt','2400'],['Wt Shift','50'],['Dist','70']], [['CG Chg','1.46','IN']]],
  ['WShift2', W(1), [['Dist','70'],['CG Chg','1.5'],['Wt Shift','C']], [['Wt Shift','51.4','LBS']]],
  ['WAdd', W(2), [['Old Wt','2200'],['Old CG','88'],['Wt Chg','40'],['Arm','120']], [['New Wt','2,240.0','LBS'],['New CG','88.57','IN']]],
  ['WRem', W(2), [['Wt Chg','40±']], [['New Wt','2,160.0','LBS'],['New CG','87.41','IN']]],
  ['MAC', W(3), [['CG','30'],['LMAC','20'],['MAC','50']], [['%MAC','20.0','%']]],
];
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const p = await b.newPage({ viewport: { width: 460, height: 860 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + require('path').resolve(__dirname, '../../index.html')); await p.waitForTimeout(1600);
  const P = async (...ks) => { for (const k of ks) await p.evaluate(k => CX3.press(k), k); };
  const rows = () => p.$$eval('#screen .li.fr', els => els.map(e => ({
    lab: e.querySelector('.lab').textContent.trim(), val: e.querySelector('.val').textContent.trim(),
    unit: e.querySelector('.unit').textContent.trim(), sel: e.classList.contains('sel') })));
  const goRow = async (label) => {
    for (let i = 0; i < 40; i++) { const r = (await rows()).find(r => r.sel); if (r && r.lab === label) return; await P('DOWN'); }
    throw new Error('row not found: ' + label);
  };
  let pass = 0, fail = 0;
  for (const [name, path, inputs, expects] of EX) {
    await P(path[0]); for (const n of path.slice(1)) { for (let i = 0; i < n; i++) await P('DOWN'); await P('ENTER'); }
    for (const [lab, keys] of inputs) {
      await goRow(lab);
      if (keys === 'C') { await P('C'); continue; }
      for (const ch of keys) await P(ch === '±' ? '+/-' : ch);
      await P('ENTER');
    }
    const rs = await rows();
    for (const [lab, val, unit] of expects) {
      const r = rs.find(r => r.lab === lab);
      const ok = r && r.val === val && r.unit.toUpperCase() === unit.toUpperCase();
      ok ? pass++ : fail++;
      if (!ok) console.log('MISMATCH', name, lab, 'doc:', val, unit, ' app:', r ? r.val + ' ' + r.unit : '(row missing)');
    }
  }
  console.log(`${pass}/${pass + fail} manual §4 values match the app display`, errs);
  await b.close();
  process.exit(fail || errs.length ? 1 : 0);
})();
