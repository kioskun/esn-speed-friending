// Phone remote bridge. Added to the show only when it is served by the phone
// remote launcher (server.ps1); opening the app file directly never loads it.
// It reports the show's state and carries out what the phone sends, through
// the same handleKey() the keyboard and the operator window use.
(function(){
  let since = -1, boot = null;

  // Only one show tab may follow the phone: the newest one opened (or
  // reloaded) takes over, older tabs stop listening.
  const me = Date.now() + '-' + Math.random().toString(36).slice(2);
  let owner = true;
  try{
    const chan = new BroadcastChannel('esn-remote');
    chan.onmessage = ev => {
      if(ev.data && ev.data.claim && ev.data.claim !== me && owner){
        owner = false;
        try{ showToast('Phone remote now follows the other show tab', 5000); } catch(e){}
      }
    };
    chan.postMessage({ claim: me });
  } catch(e){ /* very old browser: single tab assumed */ }

  // Browsers only allow sound after a real click or key on the page. A phone
  // tap doesn't count, so the first real click/key re-starts the music.
  const hadGesture = () => navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
  function wake(){
    setTimeout(() => { try{ ensureAudioCtx(); syncMusic(); } catch(e){} }, 0);
    document.removeEventListener('pointerdown', wake, true);
    document.removeEventListener('keydown', wake, true);
  }
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('keydown', wake, true);

  function state(){
    try{
      return {
        screen: SCREEN_LABEL[active] || active, active,
        round: currentRound, total: cfg.totalRounds,
        time: hudTime(), next: spaceHint(),
        status: document.getElementById('status').textContent,
        paused: isPaused, locked: lockMode, muted,
        settings: modal.classList.contains('open'),
        settingsLocked: isSettingsLocked(),
        sound: hadGesture(),
        rotations: seatHistory.length - 1,
        maxRotations: cfg.tables > 0 ? maxRepeatFreeSeatings(cfg.tables, 20) - 1 : null,
        cfg: {
          talkMin: cfg.talkMin, rotateMin: cfg.rotateMin, breakMin: cfg.breakMin, startSec: cfg.startSec,
          totalRounds: cfg.totalRounds, volume: cfg.volume, autoNext: cfg.autoNext, tables: cfg.tables,
          city: cfg.city, venue: cfg.venue, date: cfg.date, time: cfg.time, feedbackUrl: cfg.feedbackUrl || '',
          roundMusic: cfg.roundMusic || 'pulse'
        }
      };
    } catch(e){ return { error: String(e) }; }
  }

  function press(key){
    handleKey({ key, code: key === ' ' ? 'Space' : '', target: document.body, repeat: false, preventDefault(){} });
  }

  // Phone Settings go through the laptop's own Settings form and Save button,
  // so the same limits and side effects apply as when saving on the laptop.
  function applySettings(json){
    if(isSettingsLocked()){ showToast('Phone: pause the round to change Settings'); return; }
    let p; try{ p = JSON.parse(json); } catch(e){ return; }
    const put = (el, key) => { el.value = (p[key] !== undefined && p[key] !== null) ? p[key] : cfg[key]; };
    put(setTalkMin, 'talkMin'); put(setRotateMin, 'rotateMin'); put(setBreakMin, 'breakMin'); put(setStartSec, 'startSec');
    put(setTotalRounds, 'totalRounds'); put(setTables, 'tables');
    put(setCity, 'city'); put(setVenue, 'venue'); put(setTime, 'time');
    setDate.value = dateToInput(p.date !== undefined && p.date !== null ? p.date : cfg.date);
    setRoundMusic.value = p.roundMusic || cfg.roundMusic || 'pulse';
    setFeedback.value = (p.feedbackUrl !== undefined && p.feedbackUrl !== null) ? p.feedbackUrl : (cfg.feedbackUrl || '');
    setAutoNext.checked = typeof p.autoNext === 'boolean' ? p.autoNext : cfg.autoNext;
    setHudMode.value = cfg.hudMode;              // operator view mode stays as set on the laptop
    const wasOpen = modal.classList.contains('open');
    document.getElementById('btnSave').click();
    if(wasOpen) openSettings();                  // someone had Settings open on the laptop: keep it open, now showing the new values
    showToast('Settings saved from the phone');
  }

  function run(c){
    switch(c.key){
      case 'welcome': press('w'); press('w'); break;          // same as W W
      case 'reset':   press('0'); press('0'); break;          // same as 0 0
      case 'clearseating':
        clearSeating(); lastRepeats = 0; updateHud(); showToast('Seating history cleared from the phone'); break;
      case 'settings': applySettings(c.payload); break;
      case 'volume': setVolumeLive(Number(c.payload)); break;
      default: press(c.key);
    }
  }

  async function sync(){
    if(!owner) return;
    try{
      const r = await fetch('/api/sync?since=' + since, { method:'POST', body: JSON.stringify(state()), cache:'no-store' });
      const j = await r.json();
      // First contact, or the launcher was restarted: ignore anything older
      if(since < 0 || j.boot !== boot){ boot = j.boot; since = j.seq; }
      else for(const c of j.cmds){
        if(c.id <= since) continue;
        since = c.id;
        try{ run(c); } catch(e){ console.error('remote command failed', e); }
      }
      window.esnRemoteSince = since;       // last phone command handled (used by the tests)
    } catch(e){ /* launcher closed or restarting: keep trying */ }
  }

  // Chrome slows timers in background tabs to once a minute, so the heartbeat
  // comes from a small worker, which keeps its pace even when the tab is hidden.
  let running = false;
  async function tick(){ if(running) return; running = true; try{ await sync(); } finally{ running = false; } }
  try{
    const src = 'setInterval(function(){ postMessage(0); }, 150);';
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = tick;
  } catch(e){
    setInterval(tick, 150);
  }
  tick();
})();
