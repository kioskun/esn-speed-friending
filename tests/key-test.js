// Scripted browser test: presses every key on every screen and state, with
// the key lock on and off, in both operator-view modes, and checks that the
// app stays consistent (one screen, no stray timers, no errors, expected
// screen changes). Then plays a whole night with the warm-up and checks
// nobody meets twice, and checks the feedback QR on the Thank you screen.
//
//   node tests/key-test.js
//
// Uses Playwright with a fake clock, so a 15-minute round takes milliseconds.
// Locally it uses the installed Google Chrome; in CI, Playwright's Chromium.
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const APP = pathToFileURL(path.join(__dirname, '..', 'current', 'speed-friending-esn.html')).href;
const CFG_KEY = 'esn_sf_cfg_v8';

const INTRO = ['welcome','tutorial','seating','badges','volunteers','helpIntro'];
const SP = { key:' ' };
// How to reach each state from a fresh start (Welcome screen)
const STATES = {
  welcome:        { keys:[] },
  tutorial:       { keys:[SP] },
  seating:        { keys:[SP,SP] },
  badges:         { keys:[SP,SP,SP] },
  volunteers:     { keys:[SP,SP,SP,SP] },
  helpIntro:      { keys:[SP,SP,SP,SP,SP] },
  between:        { keys:[SP,SP,SP,SP,SP,SP] },
  betweenRound3:  { keys:[SP,SP,SP,SP,SP,SP, SP,{run:11e3},{run:61e3},SP, SP,{run:11e3},{run:61e3},SP] },
  startCountdown: { keys:[SP,SP,SP,SP,SP,SP,SP] },
  timerRunning:   { keys:[SP,SP,SP,SP,SP,SP,SP,{run:11e3}] },
  timerPaused:    { keys:[SP,SP,SP,SP,SP,SP,SP,{run:11e3},SP] },
  timerHelp:      { keys:[SP,SP,SP,SP,SP,SP,SP,{run:11e3},{key:'h'}] },
  timerReady:     { cfg:{ autoNext:false }, keys:[SP,SP,SP,SP,SP,SP,SP,{run:11e3}] },
  timerLast10s:   { keys:[SP,SP,SP,SP,SP,SP,SP,{run:11e3},{run:52e3}] },
  rotation:       { keys:[SP,SP,SP,SP,SP,SP,{key:'r'}] },
  rotationAuto:   { keys:[SP,SP,SP,SP,SP,SP,SP,{run:11e3},{run:61e3}] },
  warmupRotation: { keys:[SP,SP,SP,{key:'r'}] },
  break:          { keys:[SP,SP,SP,SP,SP,SP,{key:'b'}] },
  helpFull:       { keys:[SP,SP,SP,SP,SP,SP,{key:'h'}] },
  finished:       { cfg:{ totalRounds:1 }, keys:[SP,SP,SP,SP,SP,SP,SP,{run:11e3},{run:61e3}] },
  finishedQr:     { cfg:{ totalRounds:1, feedbackUrl:'https://forms.gle/example123' }, keys:[SP,SP,SP,SP,SP,SP,SP,{run:11e3},{run:61e3}] },
  settingsOpen:   { keys:[SP,SP,SP,SP,SP,SP,{key:'g'}] },
};
const KEYS = [
  { name:'Space', seq:[' '] }, { name:'Right', seq:['ArrowRight'] }, { name:'Left', seq:['ArrowLeft'] },
  { name:'R', seq:['r'] }, { name:'B', seq:['b'] }, { name:'H', seq:['h'] },
  { name:'G', seq:['g'] }, { name:'Esc', seq:['Escape'] }, { name:'O', seq:['o'] },
  { name:'L', seq:['l'] }, { name:'M', seq:['m'] }, { name:'W', seq:['w'] }, { name:'W W', seq:['w','w'] },
  { name:'0', seq:['0'] }, { name:'0 0', seq:['0','0'] }, { name:']', seq:[']'] }, { name:'[', seq:['['] },
  { name:'+', seq:['+'] }, { name:'=', seq:['='] }, { name:'-', seq:['-'] }, { name:'X', seq:['x'] },
];
const LOCK_ALLOWED = ['L','M','O','G','Esc'];

function snapshotJs(){
  return `({
    active, currentRound, isPaused, lockMode, muted,
    main: !!mainInt, cd: !!countdownInt, rot: !!rotInt,
    settings: modal.classList.contains('open'),
    screens: [...document.querySelectorAll('.screen.active')].map(e => e.id),
    status: document.getElementById('status').textContent,
    hist: seatHistory.length, timeLeft, rotLeft, breakLeft,
    qrShown: getComputedStyle(document.getElementById('feedbackBox')).display !== 'none',
    qrSvg: !!document.querySelector('#feedbackQr svg'),
    opWin: !!(opWin && !opWin.closed),
    seatInfo: modal.querySelector('#seatInfo').textContent,
    settingsInOpWin: modal.ownerDocument !== document,
    helpPrev: helpFullPrev
  })`;
}

function invariants(s, where){
  const errs = [];
  if(s.screens.length !== 1 || s.screens[0] !== s.active) errs.push(`screens ${JSON.stringify(s.screens)} vs active ${s.active}`);
  const running = [s.main && 'main', s.cd && 'countdown', s.rot && 'rotation'].filter(Boolean);
  const ALLOWED = { timer:['main'], startCountdown:['countdown'], rotation:['rotation'], break:['countdown'] };
  // Help (H) during a rotation or break keeps that timer running underneath
  const allowed = ALLOWED[s.active] || (s.active === 'helpFull' ? (ALLOWED[s.helpPrev] || []).filter(t => t !== 'main') : []);
  for(const r of running) if(!allowed.includes(r)) errs.push(`stray ${r} timer on ${s.active}`);
  if(running.length > 1) errs.push(`more than one timer running: ${running}`);
  if(s.active === 'timer' && !s.isPaused && !s.main) errs.push('conversation running without a timer');
  if(s.active === 'rotation' && !s.rot) errs.push('rotation screen without its timer');
  if(s.active === 'break' && !s.cd) errs.push('break screen without its timer');
  if(s.active === 'startCountdown' && !s.cd) errs.push('countdown screen without its timer');
  return errs.map(e => `${where}: ${e}`);
}

// What a key should do (unlocked, Settings closed). Returns a list of problems.
function expected(stateName, key, b, a){
  const errs = [];
  const is = (scr) => { if(a.active !== scr) errs.push(`expected ${scr}, got ${a.active}`); };
  const same = () => { if(a.active !== b.active) errs.push(`expected to stay on ${b.active}, got ${a.active}`); };
  if(b.settings){
    if(key === 'G' || key === 'Esc'){ if(a.settings) errs.push('Settings did not close'); }
    else if(!['O','L','M'].includes(key)){ if(!a.settings) errs.push('Settings closed by ' + key); same(); }
    return errs;
  }
  const settingsLocked = (b.active === 'timer' && !b.isPaused) || b.active === 'startCountdown';
  switch(key){
    case 'Space': {
      const i = INTRO.indexOf(b.active);
      if(i >= 0) is(i < INTRO.length-1 ? INTRO[i+1] : 'between');
      else if(b.active === 'between') is('startCountdown');
      else if(b.active === 'rotation' || b.active === 'break') is(b.active === 'rotation' && b.currentRound >= 6 ? 'finished' : 'between');
      else if(b.active === 'timer' && b.status === 'READY') is(stateName === 'timerReady' ? 'timer' : 'between');
      else if(b.active === 'timer'){ is('timer'); if(a.isPaused === b.isPaused) errs.push('Space did not pause/resume'); }
      else same();
      if(b.active === 'rotation' && a.active === 'between' && a.currentRound !== b.currentRound + 1) errs.push('round did not advance after rotation');
      break;
    }
    case 'Right': { const i = INTRO.indexOf(b.active); if(i >= 0) is(i < INTRO.length-1 ? INTRO[i+1] : 'between'); else same(); break; }
    case 'Left': {
      const i = INTRO.indexOf(b.active);
      if(i > 0) is(INTRO[i-1]);
      else if(b.active === 'between' && b.currentRound === 1) is('helpIntro');
      else same();
      break;
    }
    case 'R':
      if(b.active === 'finished'){ same(); break; }
      is('rotation');
      if(a.hist !== b.hist + 1) errs.push(`seating history ${b.hist} -> ${a.hist}, expected +1`);
      break;
    case 'B':
      if(b.active === 'finished'){ same(); break; }
      is(b.active === 'rotation' && b.currentRound >= 6 ? 'finished' : 'break');
      break;
    case 'G': case 'Esc':
      if(settingsLocked){ if(a.settings) errs.push('Settings opened while the timer runs'); }
      else if(!a.settings) errs.push('Settings did not open');
      if(a.settings && !a.seatInfo) errs.push('Settings opened without the seating info line');
      break;
    case 'L': if(!a.lockMode) errs.push('L did not lock'); break;
    case 'M': if(a.muted === b.muted) errs.push('M did not toggle mute'); break;
    case 'W W': is('welcome'); if(a.hist !== b.hist) errs.push('W W changed seating history'); break;
    case '0 0':
      is('between');
      if(a.currentRound !== 1) errs.push('reset did not go to round 1');
      if(a.hist !== b.hist) errs.push('reset lost the seating history (warm-up must be kept)');
      break;
    case 'W': case '0': case 'X': same(); if(a.currentRound !== b.currentRound) errs.push('round changed'); break;
    case ']': case '[': case '+': case '=': case '-': {
      const d = { ']':60, '[':-60, '+':30, '=':30, '-':-30 }[key];
      const val = { timer:'timeLeft', rotation:'rotLeft', break:'breakLeft' }[b.active];
      const want = val ? Math.max(0, b[val] + d) : 0;
      // Taking the timer down to 0 may end that screen straight away
      if(!(val && want <= 1)) same();
      if(val && a.active === b.active && !(b.active === 'timer' && b.status === 'READY')){
        // one clock tick may land between the two readings
        if(Math.abs(a[val] - want) > 1) errs.push(`${val} ${b[val]} -> ${a[val]}, expected ${want}`);
      }
      break;
    }
    case 'H':
      if(b.active === 'helpFull') { if(a.active === 'helpFull') errs.push('H did not leave help'); }
      else if(b.active === 'timer' || b.active === 'startCountdown') same();
      else is('helpFull');
      break;
  }
  return errs;
}

async function runCombo(browser, stateName, key, lock, mode){
  const st = STATES[stateName];
  const ctx = await browser.newContext({ viewport:{ width:1280, height:720 } });
  const failures = [];
  const where = `[${mode}${lock ? ' locked' : ''}] ${stateName} + ${key.name}`;
  ctx.on('page', p => p.on('pageerror', e => failures.push(`${where}: popup error ${e.message}`)));
  const page = await ctx.newPage();
  page.on('pageerror', e => failures.push(`${where}: page error ${e.message}`));
  await ctx.clock.install({ time: new Date('2026-09-29T18:00:00') });
  const cfg = { hudMode: mode, talkMin:1, rotateMin:1, breakMin:1, ...(st.cfg || {}) };
  await ctx.addInitScript(([k, c]) => {
    if(!sessionStorage.getItem('seeded')){ localStorage.clear(); localStorage.setItem(k, JSON.stringify(c)); sessionStorage.setItem('seeded','1'); }
  }, [CFG_KEY, cfg]);
  await page.goto(APP);
  const kb = page.keyboard;
  if(mode === 'window'){ await kb.press('o'); await ctx.clock.runFor(200); }
  for(const step of st.keys){
    if(step.run) await ctx.clock.runFor(step.run);
    else { await kb.press(step.key); await ctx.clock.runFor(50); }
  }
  if(lock){ await kb.press('l'); await ctx.clock.runFor(50); }
  const before = await page.evaluate(snapshotJs());
  failures.push(...invariants(before, where + ' (before key)'));
  if(stateName !== 'settingsOpen' && before.settings) failures.push(`${where}: Settings open during setup`);
  if(stateName.startsWith('finished')){
    const wantQr = stateName === 'finishedQr';
    if(before.active !== 'finished') failures.push(`${where}: did not reach Thank you`);
    if(before.qrShown !== wantQr || before.qrSvg !== wantQr) failures.push(`${where}: feedback QR shown=${before.qrShown} svg=${before.qrSvg}, expected ${wantQr}`);
  }

  for(const k of key.seq){ await kb.press(k); await ctx.clock.runFor(50); }
  const after = await page.evaluate(snapshotJs());
  failures.push(...invariants(after, where + ' (after key)'));

  if(lock && !LOCK_ALLOWED.includes(key.name)){
    for(const f of ['active','currentRound','isPaused','settings','hist','timeLeft','rotLeft','breakLeft'])
      if(before[f] !== after[f] && !(f.endsWith('Left') && Math.abs(before[f]-after[f]) <= 1)) failures.push(`${where}: locked key changed ${f} ${before[f]} -> ${after[f]}`);
  } else if(lock && key.name === 'L'){
    if(after.lockMode) failures.push(`${where}: L did not unlock`);
  } else if(!lock){
    failures.push(...expected(stateName, key.name, before, after).map(e => `${where}: ${e}`));
  }

  // Let 20 seconds pass: no background timer may break the screen state
  await ctx.clock.runFor(20e3);
  const later = await page.evaluate(snapshotJs());
  failures.push(...invariants(later, where + ' (20 s later)'));
  const static_ = ['welcome','tutorial','seating','badges','volunteers','helpIntro','between','finished','helpFull'];
  if(static_.includes(after.active) && later.active !== after.active) failures.push(`${where}: screen changed by itself ${after.active} -> ${later.active}`);

  await ctx.close();
  return failures;
}

// A whole night: warm-up rotation after badges, reset, 6 rounds, check
// that no two people ever share a table twice (50 tables, 200 people).
async function fullNight(browser, tables){
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const failures = [];
  page.on('pageerror', e => failures.push(`night: page error ${e.message}`));
  await ctx.clock.install({ time: new Date('2026-09-29T18:00:00') });
  await ctx.addInitScript(([k, c]) => { if(!sessionStorage.getItem('seeded')){ localStorage.clear(); localStorage.setItem(k, JSON.stringify(c)); sessionStorage.setItem('seeded','1'); } },
    [CFG_KEY, { tables, totalRounds:6, talkMin:1, rotateMin:1 }]);
  await page.goto(APP);
  const kb = page.keyboard;
  for(let i = 0; i < 3; i++) await kb.press(' ');           // to the badges screen
  await kb.press('r'); await ctx.clock.runFor(1000);         // warm-up rotation
  await kb.press('0'); await kb.press('0');                  // reset to round 1
  let s = await page.evaluate(snapshotJs());
  if(s.active !== 'between' || s.currentRound !== 1 || s.hist !== 2) failures.push(`night: after warm-up reset ${JSON.stringify({a:s.active,r:s.currentRound,h:s.hist})}`);
  // Refresh mid-event must keep the history
  await page.reload(); await ctx.clock.runFor(500);
  s = await page.evaluate(snapshotJs());
  if(s.hist !== 2) failures.push(`night: history lost on refresh (${s.hist})`);
  for(let r = 1; r <= 6; r++){
    await kb.press(' ');                                     // start countdown
    await ctx.clock.runFor(11e3);
    await ctx.clock.runFor(61e3);                  // conversation ends
    s = await page.evaluate(snapshotJs());
    if(r < 6){ if(s.active !== 'rotation') failures.push(`night: round ${r} ended on ${s.active}`); await ctx.clock.runFor(61e3); }
    else if(s.active !== 'finished') failures.push(`night: last round ended on ${s.active}`);
  }
  const hist = await page.evaluate('seatHistory');
  if(hist.length !== 7) failures.push(`night: expected 7 seatings (start, warm-up, 5 rotations), got ${hist.length}`);
  // Person-level check: 4 letters at each table, count meetings
  const met = new Set(); let repeats = 0;
  for(const pos of hist){
    const at = new Map();
    for(let t = 0; t < tables; t++) for(let L = 0; L < 4; L++){
      const table = (((t + pos[L]) % tables) + tables) % tables;
      if(!at.has(table)) at.set(table, []);
      at.get(table).push(L*1000 + t);
    }
    for(const g of at.values()) for(let i = 0; i < g.length; i++) for(let j = i+1; j < g.length; j++){
      const k = Math.min(g[i],g[j]) + '-' + Math.max(g[i],g[j]);
      if(met.has(k)) repeats++; else met.add(k);
    }
  }
  if(repeats) failures.push(`night: ${repeats} repeat meetings`);
  await ctx.close();
  return { failures, moves: hist };
}

(async () => {
  const browser = await chromium.launch(process.env.CI ? {} : { channel:'chrome' }).catch(() => chromium.launch());
  const combos = [];
  for(const mode of ['projector','window'])
    for(const lock of [false, true])
      for(const stateName of Object.keys(STATES).filter(n => !process.env.ONLY || process.env.ONLY.split(',').includes(n)))
        for(const key of KEYS) combos.push([stateName, key, lock, mode]);

  const failures = [];
  let done = 0;
  const workers = Number(process.env.WORKERS || 6);
  let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while(next < combos.length){
      const c = combos[next++];
      try{ failures.push(...await runCombo(browser, ...c)); }
      catch(e){ failures.push(`[${c[3]}${c[2]?' locked':''}] ${c[0]} + ${c[1].name}: test crashed ${e.message.split('\n')[0]}`); }
      if(++done % 200 === 0) console.log(`${done}/${combos.length} combinations`);
    }
  }));
  console.log(`Key test: ${combos.length} combinations (${Object.keys(STATES).length} states x ${KEYS.length} keys x lock on/off x 2 operator modes)`);

  for(const tables of [50, 47, 48]){
    const n = await fullNight(browser, tables);
    console.log(`Full night with warm-up, ${tables} tables: seatings ${JSON.stringify(n.moves)}` + (n.failures.length ? '' : ', 0 repeat meetings'));
    failures.push(...n.failures);
  }
  await browser.close();

  if(failures.length){
    console.log(`\nFAIL: ${failures.length} problem(s)`);
    [...new Set(failures)].slice(0, 200).forEach(f => console.log(' - ' + f));
    process.exit(1);
  }
  console.log('PASS: 0 failures');
})();
