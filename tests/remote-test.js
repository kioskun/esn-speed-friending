// Tests the phone remote (phone-remote/server.ps1) end to end:
//  1. Every phone command on every main screen does exactly what the same key
//     does on the keyboard (compared against the untouched app file).
//  2. A real run through the phone page: buttons, two-tap Rotate/Break,
//     live timer, lock, mute, extra time.
//  3. Safety: wrong code refused, old taps are never replayed, show-not-open
//     is reported, audio is served in ranges, files outside current/ refused.
//
//   node tests/remote-test.js      (needs Windows PowerShell or pwsh)
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FILE_APP = pathToFileURL(path.join(ROOT, 'current', 'speed-friending-esn.html')).href;
const PORT = 8700 + Math.floor(Math.random() * 80);
const BASE = `http://127.0.0.1:${PORT}`;
const CFG_KEY = 'esn_sf_cfg_v8';
const failures = [];
const fail = m => { failures.push(m); console.log('  FAIL ' + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(){
  const ps = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const p = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'phone-remote', 'server.ps1'),
    '-Port', String(PORT), '-LocalOnly', '-NoBrowser', '-TestMode'], { stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { if(process.env.VERBOSE) process.stdout.write(d); });
  p.stderr.on('data', d => process.stderr.write(d));
  return p;
}
async function waitUp(){
  for(let i = 0; i < 100; i++){ try{ const r = await fetch(BASE + '/api/info'); if(r.ok) return r.json(); } catch {} await sleep(200); }
  throw new Error('server did not start');
}
const phone = { 'X-Test-Remote': '1' };

function snapJs(){
  return `({ active, currentRound, isPaused, lockMode, muted, helpOpen,
    settings: modal.classList.contains('open'),
    status: document.getElementById('status').textContent,
    timeLeft, rotLeft, breakLeft, hist: seatHistory.length })`;
}

async function seededContext(browser, cfg, withClock){
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if(withClock) await ctx.clock.install({ time: new Date('2026-09-29T18:00:00') });
  await ctx.addInitScript(([k, c]) => {
    if(!sessionStorage.getItem('seeded')){ localStorage.clear(); localStorage.setItem(k, JSON.stringify(c)); sessionStorage.setItem('seeded', '1'); }
  }, [CFG_KEY, { city:'Thessaloniki', venue:'Test venue', date:'29/09/2026', time:'19:00', tables:50, ...cfg }]);
  return ctx;
}

const SP = ' ';
// Intro: Welcome, How it works, Your badge, Volunteers, Conversation starters,
// Warm-up; Space there = warm-up move, Space again = round 1 (Get ready)
const BETWEEN = [SP,SP,SP,SP,SP,SP,SP];
const STATES = {
  welcome: [], tutorial: [SP], volunteers: [SP,SP,SP], helpIntro: [SP,SP,SP,SP], warmup: [SP,SP,SP,SP,SP], between: BETWEEN,
  timerRunning: [...BETWEEN,SP,{run:11e3}], timerPaused: [...BETWEEN,SP,{run:11e3},SP],
  rotation: [...BETWEEN,'r'], break: [...BETWEEN,'b'], helpFull: [...BETWEEN,'h'],
  finished: [...BETWEEN,SP,{run:11e3},{run:61e3}],
};
// phone command -> the keys pressed on the laptop keyboard for the same thing
const REMOTE_KEYS = [' ', 'r', 'b', 'h', 'm', ']', '[', '+', '-', 'ArrowRight', 'ArrowLeft', 'l', 'welcome', 'reset'];
const KEYBOARD_FOR = { welcome: ['w','w'], reset: ['0','0'] };

async function drive(ctx, page, steps){
  for(const s of steps){
    if(typeof s === 'object') await ctx.clock.runFor(s.run);
    else { await page.keyboard.press(s); await ctx.clock.runFor(50); }
  }
}

// 1. Phone command == keyboard key, on every main screen
async function equivalence(browser, token){
  let n = 0;
  for(const [name, steps] of Object.entries(STATES)){
    for(const key of REMOTE_KEYS){
      const cfg = { talkMin: 1, rotateMin: 1, breakMin: 1, totalRounds: name === 'finished' ? 1 : 6 };
      // A: keyboard on the untouched file
      const ca = await seededContext(browser, cfg, true);
      const pa = await ca.newPage(); await pa.goto(FILE_APP);
      await drive(ca, pa, steps);
      for(const k of (KEYBOARD_FOR[key] || [key])) await pa.keyboard.press(k);
      await ca.clock.runFor(50);
      const a = await pa.evaluate(snapJs());
      await ca.close();
      // B: the same file served by the remote, key sent from the "phone"
      const cb = await seededContext(browser, cfg, true);
      const pb = await cb.newPage();
      const errs = [];
      pb.on('pageerror', e => errs.push(e.message));
      await pb.goto(BASE + '/');
      await drive(cb, pb, steps);
      // let the bridge register with the server before the tap
      for(let i = 0; i < 20; i++){ await cb.clock.runFor(310); await sleep(25); const s = await (await fetch(`${BASE}/api/state?t=${token}`, { headers: phone })).json(); if(s.connected && s.state && s.state.active === await pb.evaluate('active')) break; }
      const r = await fetch(`${BASE}/api/cmd?t=${token}&k=${encodeURIComponent(key)}`, { method: 'POST', headers: phone });
      if(!r.ok) fail(`${name} + remote ${JSON.stringify(key)}: server refused (${r.status})`);
      const { id } = await r.json();
      let handled = false;
      for(let i = 0; i < 30 && !handled; i++){
        await cb.clock.runFor(10); await sleep(40);
        handled = await pb.evaluate(`(window.esnRemoteSince || 0) >= ${id}`);
        if(!handled){ await cb.clock.runFor(300); }
      }
      if(!handled) fail(`${name} + ${JSON.stringify(key)}: the show never received the phone command`);
      let b;
      b = await pb.evaluate(snapJs());
      await cb.close();
      for(const f of ['active','currentRound','isPaused','lockMode','muted','helpOpen','settings','status'])
        if(a[f] !== b[f]) fail(`${name} + ${JSON.stringify(key)}: keyboard gives ${f}=${a[f]}, phone gives ${b[f]}`);
      for(const f of ['timeLeft','rotLeft','breakLeft'])
        if(Math.abs(a[f] - b[f]) > 10) fail(`${name} + ${JSON.stringify(key)}: keyboard gives ${f}=${a[f]}, phone gives ${b[f]}`);
      if(a.hist !== b.hist) fail(`${name} + ${JSON.stringify(key)}: seating history keyboard ${a.hist}, phone ${b.hist}`);
      errs.forEach(e => fail(`${name} + ${JSON.stringify(key)}: page error ${e}`));
      n++;
    }
  }
  console.log(`Phone command = keyboard key: ${n} combinations (${Object.keys(STATES).length} screens x ${REMOTE_KEYS.length} commands)`);
}

// 2. Real use of the phone page (real time, short rounds)
async function phoneRun(browser, token){
  const show = await seededContext(browser, { talkMin: 1, rotateMin: 1, breakMin: 1, startSec: 2, totalRounds: 6, tables: 50 }, false);
  const sp = await show.newPage();
  const errs = [];
  sp.on('pageerror', e => errs.push('show: ' + e.message));
  await sp.goto(BASE + '/');
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: phone, hasTouch: true });
  const pp = await ph.newPage();
  pp.on('pageerror', e => errs.push('phone: ' + e.message));
  await pp.goto(`${BASE}/remote?t=${token}`);
  await sleep(300);
  if(pp.url().includes(token)) fail('the key stays in the phone address bar');
  // Quick start guide on the first visit
  if(!(await pp.isVisible('#guide'))) fail('quick start guide not shown the first time');
  await pp.click('#bGuideClose');
  await pp.reload(); await sleep(500);
  if(await pp.isVisible('#guide')) fail('quick start guide shown again after Got it');
  const S = () => sp.evaluate(snapJs());
  const until = async (label, fn, ms = 5000) => {
    const t0 = Date.now();
    while(Date.now() - t0 < ms){ const s = await S(); if(fn(s)) return s; await sleep(100); }
    fail('phone run: ' + label + ' (now ' + JSON.stringify(await S()) + ')');
  };
  const tap = sel => pp.click(sel);
  const text = sel => pp.textContent(sel);

  await pp.waitForFunction(() => document.getElementById('connText').textContent === 'Connected', null, { timeout: 5000 }).catch(() => fail('phone never showed Connected'));
  if((await text('#screen')) !== 'Welcome') fail('phone does not show the Welcome screen: ' + await text('#screen'));
  if((await text('#bSpace')) !== 'Next screen') fail('big button should say Next screen, says ' + await text('#bSpace'));

  await tap('button[data-k="ArrowRight"]'); await until('Next ▶ goes to How it works', s => s.active === 'tutorial');
  await tap('button[data-k="ArrowLeft"]'); await until('◀ Back returns to Welcome', s => s.active === 'welcome');
  for(let i = 0; i < 7; i++){ const a = (await S()).active; await tap('#bSpace'); await until('big button steps the intro', s => s.active !== a); }
  await until('reach Get ready (round 1 after the warm-up move)', s => s.active === 'between' && s.currentRound === 1 && s.hist === 2);

  // Rotate needs two taps
  const h0 = (await S()).hist;
  await tap('#bRotate'); await sleep(900);
  if((await S()).active !== 'between') fail('one tap on Rotate already rotated');
  if(!(await text('#bRotate')).includes('again')) fail('Rotate did not ask for a second tap');
  await tap('#bRotate'); await until('second tap rotates', s => s.active === 'rotation' && s.hist === h0 + 1);
  await tap('#bSpace'); await until('Skip rotation', s => s.active === 'between' && s.currentRound === 2);

  // Start the round and let the 2 s countdown run
  await tap('#bSpace'); await until('countdown then round runs', s => s.active === 'timer' && !s.isPaused, 6000);
  await pp.waitForFunction(() => /^\d\d:\d\d$/.test(document.getElementById('time').textContent) && document.getElementById('bSpace').textContent === 'Pause', null, { timeout: 3000 })
    .catch(() => fail('phone does not show the live timer / Pause'));
  let t = (await S()).timeLeft;
  await tap('button[data-k="]"]'); await until('+1 min', s => s.timeLeft >= t + 57);
  t = (await S()).timeLeft;
  await tap('button[data-k="-"]'); await until('−30 s', s => s.timeLeft <= t - 28 && s.timeLeft >= t - 33);
  t = (await S()).timeLeft;
  await tap('button[data-k="+"]'); await until('+30 s', s => s.timeLeft >= t + 27);
  t = (await S()).timeLeft;
  await tap('button[data-k="["]'); await until('−1 min', s => s.timeLeft <= t - 58);
  await tap('#bSpace'); await until('Pause', s => s.isPaused && s.status === 'PAUSED');
  await pp.waitForFunction(() => document.getElementById('bSpace').textContent === 'Resume', null, { timeout: 3000 }).catch(() => fail('phone does not offer Resume'));
  await tap('#bSpace'); await until('Resume', s => !s.isPaused);
  await tap('button[data-k="h"]'); await until('Help opens during the round', s => s.helpOpen);
  await tap('button[data-k="h"]'); await until('Help closes', s => !s.helpOpen);
  await tap('#bMute'); await until('Mute', s => s.muted);
  await pp.waitForFunction(() => document.getElementById('bMute').textContent === 'Unmute', null, { timeout: 3000 }).catch(() => fail('phone does not offer Unmute'));
  await tap('#bMute'); await until('Unmute', s => !s.muted);

  // Keyboard lock on the laptop also locks the phone (except Mute), and the phone says so
  await sp.keyboard.press('l');
  await pp.waitForFunction(() => document.getElementById('flags').textContent.includes('LOCKED'), null, { timeout: 3000 }).catch(() => fail('phone does not show KEYS LOCKED'));
  const tl = (await S()).timeLeft;
  await tap('#bSpace'); await sleep(1200);
  if((await S()).isPaused) fail('phone paused the round while keys were locked');
  await tap('#bMute'); await until('Mute still works while locked', s => s.muted);
  await tap('#bMute'); await until('unmute while locked', s => !s.muted);
  await sp.keyboard.press('l'); await until('unlock', s => !s.lockMode);

  // Break needs two taps
  await tap('#bBreak'); await sleep(900);
  if((await S()).active !== 'timer') fail('one tap on Break already started a break');
  await tap('#bBreak'); await until('Break', s => s.active === 'break');
  await tap('#bSpace'); await until('Skip break', s => s.active === 'between');

  // Lock from the phone, and unlock again
  await tap('#bLock'); await until('phone Lock keys', s => s.lockMode);
  await tap('#bSpace'); await sleep(1200);
  if((await S()).active !== 'between') fail('phone Space worked while keys were locked');
  await pp.waitForFunction(() => document.getElementById('bLock').textContent === 'Unlock keys', null, { timeout: 3000 }).catch(() => fail('phone does not offer Unlock keys'));
  await tap('#bLock'); await until('phone Unlock keys', s => !s.lockMode);

  // Settings from the phone: filled with the show's values, saved through the laptop's Save (same limits)
  await tap('#bSettings');
  if((await pp.inputValue('#talkMin')) !== '1' || (await pp.inputValue('#tables')) !== '50') fail('phone Settings not filled with the current values');
  await pp.fill('#talkMin', '20'); await pp.fill('#tables', '47'); await pp.fill('#date', '2026-09-29'); await pp.fill('#time2', '19:30');
  await pp.selectOption('#roundMusic', 'deep');
  await pp.fill('#feedbackUrl', 'https://forms.gle/phoneTest1'); await pp.fill('#venue', 'Phone Venue');
  await pp.uncheck('#autoNext');
  await tap('#bSave');
  await sp.waitForFunction(() => cfg.talkMin === 20 && cfg.tables === 47, null, { timeout: 5000 }).catch(() => fail('phone Settings were not applied'));
  const c = await sp.evaluate(() => ({ cfg, saved: JSON.parse(localStorage.getItem('esn_sf_cfg_v8')), info: document.getElementById('evInfo').textContent,
    qr: !!document.querySelector('#feedbackQr svg') }));
  if(c.cfg.date !== '29/09/2026' || c.cfg.time !== '19:30' || c.cfg.roundMusic !== 'deep') fail('phone date/time/music not saved: ' + JSON.stringify([c.cfg.date, c.cfg.time, c.cfg.roundMusic]));
  if(!c.info.includes('29/09/2026 | 19:30')) fail('date/time from the phone not shown on Welcome: ' + c.info);
  if(c.cfg.autoNext !== false || c.cfg.feedbackUrl !== 'https://forms.gle/phoneTest1' || c.cfg.startSec !== 2 || c.cfg.hudMode !== 'projector') fail('phone Settings: wrong values ' + JSON.stringify(c.cfg));
  if(!c.saved || c.saved.talkMin !== 20) fail('phone Settings were not saved (lost on refresh)');
  if(!c.info.includes('Phone Venue')) fail('venue from the phone not shown on the Welcome screen');
  if(!c.qr) fail('feedback QR not made from the phone link');
  if(await pp.isVisible('#sheet')) fail('Settings panel did not close after Save');

  // Live volume slider (no Settings needed)
  await pp.evaluate(() => { const v = document.getElementById('volSlider'); v.value = 35; v.dispatchEvent(new Event('change')); });
  await sp.waitForFunction(() => cfg.volume === 35, null, { timeout: 4000 }).catch(() => fail('phone volume slider did not change the volume'));
  if((await sp.evaluate(() => JSON.parse(localStorage.getItem('esn_sf_cfg_v8')).volume)) !== 35) fail('volume from the phone not saved');
  if(!(await pp.isVisible('#volSlider'))) fail('volume slider not on the main controls');

  // Clear seating history needs two taps
  const hBefore = (await S()).hist;
  if(hBefore < 2) fail('expected some seating history before clearing');
  await tap('#bSettings');
  await tap('button[data-k="clearseating"]'); await sleep(900);
  if((await S()).hist !== hBefore) fail('one tap cleared the seating history');
  await tap('button[data-k="clearseating"]'); await until('Clear seating history', s => s.hist === 1);
  await tap('#bCancel');

  // Welcome needs two taps
  await tap('button[data-k="welcome"]'); await sleep(900);
  if((await S()).active === 'welcome') fail('one tap on Welcome already jumped');
  await tap('button[data-k="welcome"]'); await until('Welcome screen', s => s.active === 'welcome');

  // Reset to round 1 (two taps) on the main controls
  await tap('button[data-k="reset"]'); await sleep(900);
  if((await S()).active !== 'welcome') fail('one tap on Reset already reset');
  await tap('button[data-k="reset"]'); await until('Reset to round 1', s => s.active === 'between' && s.currentRound === 1);

  // Settings are refused while a round runs (same rule as the laptop)
  await sp.evaluate(() => { cfg.autoNext = true; });
  await tap('#bSpace'); await until('round runs again', s => s.active === 'timer' && !s.isPaused, 6000);
  await tap('#bSettings');
  if(!(await pp.textContent('#setNote')).includes('pause')) fail('phone Settings did not say to pause first');
  await pp.fill('#talkMin', '33'); await tap('#bSave'); await sleep(1500);
  if((await sp.evaluate('cfg.talkMin')) === 33) fail('Settings changed from the phone while the round was running');
  await tap('#bBack');
  if(await pp.isVisible('#sheet')) fail('← Back did not close the phone Settings');

  // Laptop keyboard keeps working alongside the phone
  await sp.keyboard.press(' '); await until('laptop Space still works', s => s.active === 'startCountdown' || s.active === 'timer');

  errs.forEach(e => fail('phone run: ' + e));
  await ph.close(); await show.close();
  console.log('Phone page run-through: done');
}

// 4. A device that keeps guessing is shut out (runs last: it blocks this test's "phone")
async function lockout(token){
  for(let i = 0; i < 20; i++) await fetch(`${BASE}/api/state`, { headers: { ...phone, 'X-Remote-Key': 'guess' + i } });
  const r = await fetch(`${BASE}/api/state`, { headers: { ...phone, 'X-Remote-Key': token } });
  if(r.status !== 403) fail('a device was not shut out after 20 wrong keys');
  if(!(await fetch(`${BASE}/api/state`)).ok) fail('the laptop itself was shut out');
  console.log('Lockout after wrong keys: done');
}

// 3. Safety checks
async function safety(browser, token){
  const bad = await fetch(`${BASE}/api/cmd?t=WRONG1&k=r`, { method: 'POST', headers: phone });
  if(bad.status !== 403) fail('wrong code was accepted');
  const bad2 = await fetch(`${BASE}/api/cmd?t=${token}&k=0`, { method: 'POST', headers: phone });
  if(bad2.status !== 400) fail('a key outside the phone list (0 = reset) was accepted');
  // The code: 6 random letters/numbers (header or the QR's ?t=)
  if(!/^[2-9A-HJKMNP-Z]{6}$/.test(token)) fail('access code is not 6 random letters/numbers: ' + token);
  if((await fetch(`${BASE}/api/state`, { headers: { ...phone, 'X-Remote-Key': token } })).status !== 200) fail('right code in the header refused');
  if((await fetch(`${BASE}/api/state`, { headers: { ...phone, 'X-Remote-Key': token.slice(1) + (token[0] === '2' ? '3' : '2') } })).status !== 403) fail('wrong code accepted');
  // ...and a new one on every start
  const PORT2 = PORT + 1;
  const ps0 = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const other = spawn(ps0, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'phone-remote', 'server.ps1'), '-Port', String(PORT2), '-LocalOnly', '-NoBrowser', '-TestMode']);
  let token2 = null;
  for(let i = 0; i < 100 && !token2; i++){ try{ token2 = (await (await fetch(`http://127.0.0.1:${PORT2}/api/info`)).json()).token; } catch { await sleep(200); } }
  other.kill();
  if(!token2 || token2 === token) fail(`the code did not change on a new start (${token} / ${token2})`);
  if((await fetch(`${BASE}/api/state`, { headers: phone })).status !== 403) fail('state given to a phone without a key');
  const page = await (await fetch(`${BASE}/remote`, { headers: phone })).text();
  if(page.includes(token)) fail('the phone page contains the key');
  if((await fetch(`${BASE}/`, { headers: phone })).status !== 403) fail('show served to a phone without the code');
  if((await fetch(`${BASE}/?t=${token}`, { headers: phone })).status !== 403) fail('show served to a phone (it should be laptop only)');
  if((await fetch(`${BASE}/connect`, { headers: phone })).status !== 403) fail('connect page (with the code) served to a phone');
  if((await fetch(`${BASE}/api/sync?since=0`, { method: 'POST', headers: phone, body: '{}' })).status !== 403) fail('a phone could pretend to be the show');
  for(const p of ['/..%2fREADME.md', '/..%5cREADME.md', '/%2e%2e/README.md'])
    if((await fetch(BASE + p)).status !== 404) fail('file outside current/ served: ' + p);
  const media = await fetch(`${BASE}/assets/audio/bg.mp3`, { headers: { Range: 'bytes=0-' } });
  if(media.status !== 206 || !/^bytes 0-\d+\/\d+$/.test(media.headers.get('content-range') || '')) fail('audio not served in ranges');
  await media.arrayBuffer();

  // Show not open: the phone is told, and the tap is never replayed later
  await sleep(3500);
  const st = await (await fetch(`${BASE}/api/state?t=${token}`, { headers: phone })).json();
  if(st.connected) fail('phone says Connected while no show is open');
  const r = await (await fetch(`${BASE}/api/cmd?t=${token}&k=r`, { method: 'POST', headers: phone })).json();
  if(r.showConnected) fail('command reply claims the show is connected');
  await sleep(1000);
  const ctx = await seededContext(browser, {}, false);
  const pg = await ctx.newPage(); await pg.goto(BASE + '/'); await sleep(2500);
  if((await pg.evaluate('active')) !== 'welcome') fail('an old phone tap was replayed when the show opened');

  // Sound warning: no click on the show yet -> phone is told; after a click it clears
  let s1 = await (await fetch(`${BASE}/api/state?t=${token}`, { headers: phone })).json();
  if(!s1.state || s1.state.sound !== false) fail('phone not warned that the show has had no click (no sound)');
  await pg.mouse.click(640, 360); await sleep(1200);
  s1 = await (await fetch(`${BASE}/api/state?t=${token}`, { headers: phone })).json();
  if(!s1.state || s1.state.sound !== true) fail('sound warning did not clear after a click on the show');

  // Two show tabs: only the newest follows the phone
  const pg2 = await ctx.newPage(); await pg2.goto(BASE + '/'); await sleep(1500);
  const rr = await (await fetch(`${BASE}/api/cmd?t=${token}&k=%20`, { method: 'POST', headers: phone })).json();
  await sleep(1500);
  const [a1, a2] = [await pg.evaluate('active'), await pg2.evaluate('active')];
  if(a2 !== 'tutorial') fail(`newest show tab did not follow the phone (${a2})`);
  if(a1 !== 'welcome') fail(`older show tab also followed the phone (${a1})`);
  await ctx.close();

  // Other web pages on the laptop can't send commands
  const cs = await fetch(`${BASE}/api/cmd?k=r`, { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } });
  if(cs.status !== 403) fail('a command from another web site was accepted');

  // Oversized request is dropped and the server keeps working
  await new Promise(res => {
    const sock = require('net').connect(PORT, '127.0.0.1', () => {
      sock.write('GET / HTTP/1.1\r\nX-Big: ' + 'a'.repeat(80000));
      setTimeout(() => { sock.destroy(); res(); }, 1500);
    });
    sock.on('error', () => res());
  });
  if(!(await fetch(BASE + '/api/info')).ok) fail('server stopped answering after an oversized request');

  // A second launcher on the same port refuses to start (instead of moving port and losing Settings)
  const ps = process.platform === 'win32' ? 'powershell' : 'pwsh';
  const second = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'phone-remote', 'server.ps1'), '-Port', String(PORT), '-LocalOnly', '-NoBrowser', '-TestMode']);
  let out2 = ''; second.stdout.on('data', d => out2 += d);
  const code2 = await new Promise(res => { second.on('exit', c => res(c)); setTimeout(() => { second.kill(); res('timeout'); }, 20000); });
  if(code2 !== 1 || !out2.includes('already running')) fail(`second launcher did not refuse the busy port (exit ${code2})`);
  console.log('Safety checks: done');
}

(async () => {
  const srv = startServer();
  let browser;
  try{
    const info = await waitUp();
    browser = await chromium.launch(process.env.CI ? {} : { channel: 'chrome' }).catch(() => chromium.launch());
    await safety(browser, info.token);
    await phoneRun(browser, info.token);
    await equivalence(browser, info.token);
    await lockout(info.token);
  } catch(e){ fail('test crashed: ' + (e.stack || e.message)); }
  finally{ if(browser) await browser.close(); srv.kill(); }
  if(failures.length){ console.log(`\nFAIL: ${failures.length} problem(s)`); process.exit(1); }
  console.log('PASS: 0 failures');
  process.exit(0);
})();
