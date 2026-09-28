// Simulates whole speed friending nights person by person and counts how
// often two people end up at the same table again.
// Uses the exact rotation code from current/speed-friending-esn.html
// (the block between SEATING-ALGO-START and SEATING-ALGO-END).
//
//   node tests/simulate-rotation.js            full run (200,000 nights)
//   node tests/simulate-rotation.js --quick    CI run (fewer nights)
//
// Exits with code 1 if any repeat meeting happens where the table count
// allows a repeat-free night.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'current', 'speed-friending-esn.html'), 'utf8');
const m = html.match(/\/\* SEATING-ALGO-START[\s\S]*?\/\* SEATING-ALGO-END \*\//);
if(!m) { console.error('Rotation code block not found in the app'); process.exit(1); }
const { planRotation, rotationsToPlan, maxRepeatFreeSeatings } =
  new Function(m[0] + '\nreturn { planRotation, rotationsToPlan, maxRepeatFreeSeatings };')();

const quick = process.argv.includes('--quick');

// Small seeded random generator so runs are repeatable
function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// The v7 rule, for comparison: a random shuffle of stay/1/2/3, different from last time.
function v7Picker(rand){
  let last = null;
  return () => { let mv; do { mv = [0,1,2,3]; for(let i=3;i>0;i--){ const j=Math.floor(rand()*(i+1)); [mv[i],mv[j]]=[mv[j],mv[i]]; } } while(last && mv.join() === last.join()); last = mv; return mv; };
}

// One night. tables: table count set in Settings. rounds: conversation rounds.
// warmup: one rotation right after badges, then reset (history kept).
// short: number of tables that only have 3 people (random missing letter).
function night({ tables, rounds, warmup, short, algo, rand }){
  const people = [];   // [letter, startTable]
  for(let t = 0; t < tables; t++){
    const missing = t < short ? Math.floor(rand()*4) : -1;
    for(let L = 0; L < 4; L++) if(L !== missing) people.push([L, t]);
  }
  const N = people.length;
  const met = new Uint8Array(N*N);
  let repeats = 0, fallbacks = 0;
  const history = [[0,0,0,0]];
  const v7 = v7Picker(rand);

  function seat(){
    const pos = history[history.length-1];
    const byTable = new Map();
    people.forEach(([L, s], i) => {
      const t = ((s + pos[L]) % tables + tables) % tables;
      if(!byTable.has(t)) byTable.set(t, []);
      byTable.get(t).push(i);
    });
    for(const group of byTable.values()){
      for(let a = 0; a < group.length; a++) for(let b = a+1; b < group.length; b++){
        const k = group[a]*N + group[b];
        if(met[k]) repeats++; else met[k] = 1;
      }
    }
  }
  function rotate(currentRound){
    let mv;
    if(algo === 'v7') mv = v7();
    else {
      const plan = planRotation(history, tables, rotationsToPlan(rounds, currentRound), rand);
      if(plan.repeats) fallbacks++;
      mv = plan.moves;
    }
    const last = history[history.length-1];
    history.push(last.map((v,i) => v + mv[i]));
  }

  seat();                       // people sit down, badges handed out
  if(warmup){ rotate(1); seat(); }   // warm-up rotation, then 0 0 reset to round 1
  for(let r = 1; r < rounds; r++){ rotate(r); seat(); }   // rotations between rounds
  return { repeats, fallbacks, hadRepeat: repeats > 0 };
}

function run(label, opts, nights){
  const rand = rng(12345 + nights + opts.tables*7 + opts.rounds*131 + (opts.warmup?1:0));
  let total = 0, nightsWithRepeat = 0, fallbacks = 0;
  for(let i = 0; i < nights; i++){
    const r = night({ ...opts, rand });
    total += r.repeats; fallbacks += r.fallbacks; if(r.hadRepeat) nightsWithRepeat++;
  }
  const row = { label, nights, tables: opts.tables, rounds: opts.rounds, warmup: !!opts.warmup, short: opts.short||0,
    nightsWithRepeat, pctNights: (100*nightsWithRepeat/nights).toFixed(2)+'%', avgRepeatMeetings: (total/nights).toFixed(2), fallbacks };
  console.log(JSON.stringify(row));
  return row;
}

let failed = false;
const N = quick ? 2000 : 200000;
console.log('--- v7 rule (before the fix), 50 tables ---');
run('v7', { tables:50, rounds:6, warmup:false, algo:'v7' }, quick ? 2000 : 20000);
run('v7', { tables:50, rounds:6, warmup:true,  algo:'v7' }, quick ? 2000 : 20000);

console.log('--- new rule, Harry\'s setup: about 50 tables, 6 rounds ---');
for(const warmup of [false, true]){
  for(const short of [0, 3]){
    const r = run('new', { tables:50, rounds:6, warmup, short, algo:'new' }, N);
    if(r.nightsWithRepeat) failed = true;
  }
}

console.log('--- new rule, longer nights and other table counts ---');
for(const tables of [7, 8, 11, 12, 20, 30, 39, 40, 42, 45, 47, 48, 50, 51, 55, 60]){
  for(const rounds of [6, 8, 10, 12]){
    // Some table counts cannot give all-new faces for long nights (for
    // example a multiple of 3 tables allows only tables/3 seatings). A full
    // search gives the true limit; below it there must be zero repeats.
    const seatings = rounds + 1;   // with warm-up
    const possible = maxRepeatFreeSeatings(tables, 30);
    const r = run('new', { tables, rounds, warmup:true, short:1, algo:'new' }, quick ? 200 : 5000);
    console.log(`   ${tables} tables: repeat-free possible for ${possible >= 30 ? '30+' : possible} seatings, this night needs ${seatings}` + (seatings <= possible ? (r.nightsWithRepeat ? '  <-- FAIL' : '  ok') : '  (not possible, fallback used)'));
    if(seatings <= possible && r.nightsWithRepeat) failed = true;
  }
}

console.log('--- too few tables: must fall back gracefully (fewest repeats, no crash) ---');
for(const tables of [4, 5, 6]) run('new', { tables, rounds:8, warmup:true, algo:'new' }, quick ? 100 : 2000);

console.log(failed ? 'FAIL: repeat meetings found' : 'PASS: zero repeat meetings wherever the table count allows it');
process.exit(failed ? 1 : 0);
