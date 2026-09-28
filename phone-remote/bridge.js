// Phone remote bridge. Added to the show only when it is served by the phone
// remote launcher (server.ps1); opening the app file directly never loads it.
// It reports the show's state and presses the keys the phone sends, through
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
        sound: hadGesture()
      };
    } catch(e){ return { error: String(e) }; }
  }
  function press(key){
    handleKey({ key, code: key === ' ' ? 'Space' : '', target: document.body, repeat: false, preventDefault(){} });
  }
  async function sync(){
    if(owner){
      try{
        const r = await fetch('/api/sync?since=' + since, { method:'POST', body: JSON.stringify(state()), cache:'no-store' });
        const j = await r.json();
        // First contact, or the launcher was restarted: ignore anything older
        if(since < 0 || j.boot !== boot){ boot = j.boot; since = j.seq; }
        else for(const c of j.cmds){
          if(c.id <= since) continue;
          since = c.id;
          try{ press(c.key); } catch(e){ console.error('remote key failed', e); }
        }
        window.esnRemoteSince = since;       // last phone command handled (used by the tests)
      } catch(e){ /* launcher closed or restarting: keep trying */ }
    }
    setTimeout(sync, 300);
  }
  sync();
})();
