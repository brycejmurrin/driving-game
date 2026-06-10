/*
 * WebAudio synth: engine drone tied to speed, arcade SFX, and a small
 * looping chiptune. Everything is generated — no audio assets.
 * init() must be called from a user gesture so the context can start.
 */
"use strict";

const GameAudio = (function () {
  let ctx = null;
  let master = null;
  let muted = false;
  let outRoute = "none";    // "playback" | "default" — shown in status()

  // Engine voice (persistent while racing)
  let engOsc1 = null, engOsc2 = null, engFilter = null, engGain = null;
  let engineOn = false;
  // Tire-screech voice for drifting (looped noise, gated by setSkid)
  let skidSrc = null, skidFilter = null, skidGain = null;

  // Music sequencer
  let musicOn = false;
  let musicTimer = null;
  let step = 0;

  let listenersAttached = false;
  let rebuildTries = 0;

  function createCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;

    // iOS 17+: play through the ring/silent switch like a game should.
    // The Audio Session API must be set BEFORE the context is created.
    // Same recipe as Neon Swarm / Neon Slice.
    outRoute = "default";
    try {
      if (typeof navigator !== "undefined" && navigator.audioSession) {
        navigator.audioSession.type = "playback";
        outRoute = "playback";
      }
    } catch (e) { /* older iOS */ }

    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);

    // iOS Safari starts contexts suspended; resume inside the gesture.
    if (ctx.state !== "running") ctx.resume();
    return true;
  }

  function init() {
    // init is only ever called from a user gesture
    if (ctx) {
      resumeIfNeeded(true);
      return;
    }
    if (!createCtx()) return;

    if (!listenersAttached) {
      listenersAttached = true;
      // iOS suspends the context on lock/app-switch and never resumes it
      // by itself; recover on the next gesture or on returning to the tab.
      window.addEventListener("touchend", resumeIfNeeded, true);
      window.addEventListener("pointerdown", resumeIfNeeded, true);
      window.addEventListener("keydown", resumeIfNeeded, true);
      document.addEventListener("visibilitychange", onVisibility);
    }
  }

  let lastFailedResume = 0;

  /*
   * Resume the context if it isn't running. ctx.resume() is async and
   * slow on iOS, so never tear the context down on a timer — a context
   * that's about to start would be destroyed, and one created outside a
   * user gesture can never be unlocked. Instead: if a PREVIOUS gesture
   * tried to resume and the context still isn't running by the time a
   * later gesture arrives, rebuild inside that gesture.
   */
  function resumeIfNeeded(gestureEv) {
    if (!ctx) return;
    const isGesture = !!gestureEv;
    if (ctx.state === "running") {
      rebuildTries = 0;
      lastFailedResume = 0;
      return;
    }
    if (isGesture && lastFailedResume &&
        Date.now() - lastFailedResume > 700 && rebuildTries < 3) {
      rebuildTries++;
      lastFailedResume = 0;
      rebuildCtx();
      return;
    }
    if (isGesture) lastFailedResume = Date.now();
    const p = ctx.resume();
    if (p && p.then) {
      p.then(function () {
        rebuildTries = 0;
        lastFailedResume = 0;
      }).catch(function () {});
    }
  }

  function rebuildCtx() {
    const wasMusic = musicOn;
    const wasEngine = engineOn;
    if (musicOn) stopMusic();
    engineOn = false;               // old nodes died with the old context
    try { ctx.close(); } catch (e) { /* already closed */ }
    ctx = null;
    master = null;
    if (!createCtx()) return;
    if (wasMusic) startMusic();
    if (wasEngine) startEngine();
  }

  let resumeMusic = false;
  let resumeEngine = false;

  function onVisibility() {
    if (document.hidden) {
      resumeMusic = musicOn;
      resumeEngine = engineOn;
      if (musicOn) stopMusic();
      if (engineOn) stopEngine();
    } else {
      resumeIfNeeded();
      if (resumeMusic) startMusic();   // restarts cleanly re-synced to the clock
      if (resumeEngine) startEngine();
      resumeMusic = resumeEngine = false;
    }
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.8;
  }

  function now() { return ctx ? ctx.currentTime : 0; }

  function env(gainNode, t0, peak, attack, decay) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.linearRampToValueAtTime(peak, t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function blip(freq, type, peak, attack, decay, slideTo, when) {
    if (!ctx) return;
    const t0 = now() + (when || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + attack + decay);
    env(g, t0, peak, attack, decay);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.05);
  }

  function noise(peak, decay, filterFreq, when) {
    if (!ctx) return;
    const t0 = now() + (when || 0);
    const len = Math.ceil(ctx.sampleRate * (decay + 0.05));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    env(g, t0, peak, 0.005, decay);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + decay + 0.1);
  }

  /* ---------------- engine ---------------- */

  function startEngine() {
    if (!ctx || engineOn) return;
    engOsc1 = ctx.createOscillator();
    engOsc2 = ctx.createOscillator();
    engFilter = ctx.createBiquadFilter();
    engGain = ctx.createGain();
    engOsc1.type = "sawtooth";
    engOsc2.type = "square";
    engOsc1.frequency.value = 55;
    engOsc2.frequency.value = 55.7;
    engFilter.type = "lowpass";
    engFilter.frequency.value = 320;
    engGain.gain.value = 0.0;
    engOsc1.connect(engFilter);
    engOsc2.connect(engFilter);
    engFilter.connect(engGain).connect(master);
    engOsc1.start();
    engOsc2.start();

    // looping noise through a bandpass = tire screech, silent until drifting
    const len = Math.ceil(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    skidSrc = ctx.createBufferSource();
    skidSrc.buffer = buf;
    skidSrc.loop = true;
    skidFilter = ctx.createBiquadFilter();
    skidFilter.type = "bandpass";
    skidFilter.frequency.value = 950;
    skidFilter.Q.value = 1.4;
    skidGain = ctx.createGain();
    skidGain.gain.value = 0;
    skidSrc.connect(skidFilter).connect(skidGain).connect(master);
    skidSrc.start();
    engineOn = true;
  }

  function stopEngine() {
    if (!engineOn) return;
    const t0 = now();
    engGain.gain.linearRampToValueAtTime(0, t0 + 0.2);
    engOsc1.stop(t0 + 0.3);
    engOsc2.stop(t0 + 0.3);
    skidGain.gain.linearRampToValueAtTime(0, t0 + 0.1);
    skidSrc.stop(t0 + 0.2);
    skidSrc = null;
    engineOn = false;
  }

  // intensity 0..1; wobble the filter so the screech feels alive
  function setSkid(intensity) {
    if (!engineOn || !skidGain) return;
    const v = Math.max(0, Math.min(1, intensity));
    skidGain.gain.value = v * 0.16;
    if (v > 0) {
      skidFilter.frequency.value = 750 + v * 500 + Math.sin(now() * 30) * 90;
    }
  }

  // speed01: 0..1, boosting / offroad shape the tone
  function setEngine(speed01, boosting, offroad) {
    if (!engineOn) return;
    const base = 50 + speed01 * 170 + (boosting ? 40 : 0);
    engOsc1.frequency.value = base;
    engOsc2.frequency.value = base * 1.012 + (offroad ? 7 : 0);
    engFilter.frequency.value = 280 + speed01 * 1400 + (boosting ? 800 : 0);
    engGain.gain.value = 0.04 + speed01 * 0.055 + (offroad ? 0.02 : 0);
  }

  /* ---------------- sfx ---------------- */

  function coin() {
    blip(988, "square", 0.18, 0.01, 0.07);
    blip(1319, "square", 0.16, 0.01, 0.16, null, 0.07);
  }

  function boostPad() {
    blip(220, "sawtooth", 0.25, 0.02, 0.35, 880);
    noise(0.12, 0.3, 2400);
  }

  function driftBoost() {
    blip(330, "sawtooth", 0.25, 0.02, 0.3, 990);
    blip(660, "square", 0.12, 0.02, 0.25, 1320, 0.05);
  }

  function skid() {
    noise(0.06, 0.12, 1500);
  }

  function hitCone() {
    blip(160, "square", 0.3, 0.005, 0.18, 70);
    noise(0.2, 0.15, 1000);
  }

  function oilSlip() {
    blip(500, "sine", 0.2, 0.02, 0.4, 120);
  }

  function bonk() {
    blip(110, "square", 0.28, 0.005, 0.12, 60);
    noise(0.15, 0.1, 700);
  }

  function countdown(final) {
    if (final) blip(880, "square", 0.3, 0.01, 0.5);
    else blip(440, "square", 0.25, 0.01, 0.25);
  }

  function lap(finalLap) {
    blip(659, "square", 0.2, 0.01, 0.12);
    blip(880, "square", 0.2, 0.01, 0.18, null, 0.1);
    if (finalLap) blip(1175, "square", 0.2, 0.01, 0.3, null, 0.2);
  }

  function finish(won) {
    const notes = won ? [523, 659, 784, 1047, 784, 1047] : [392, 330, 262];
    notes.forEach(function (f, i) {
      blip(f, "square", 0.22, 0.01, 0.22, null, i * 0.13);
    });
  }

  function uiSelect() {
    blip(740, "square", 0.15, 0.005, 0.08);
  }

  function itemGet() {
    [523, 659, 784].forEach(function (f, i) {
      blip(f, "square", 0.16, 0.01, 0.09, null, i * 0.06);
    });
  }

  function fireMissile() {
    blip(880, "sawtooth", 0.25, 0.01, 0.4, 220);
    noise(0.18, 0.35, 3000);
  }

  function explosion() {
    blip(90, "square", 0.35, 0.005, 0.3, 40);
    noise(0.3, 0.4, 900);
  }

  function dropOil() {
    blip(300, "sine", 0.2, 0.02, 0.25, 90);
  }

  function jump() {
    blip(330, "square", 0.22, 0.02, 0.3, 740);
    noise(0.08, 0.15, 3000);
  }

  function land() {
    noise(0.2, 0.12, 700);
    blip(140, "sine", 0.18, 0.005, 0.1, 70);
  }

  /* ---------------- music ---------------- */

  /*
   * Lookahead sequencer: notes are scheduled on the WebAudio clock up to
   * 300ms ahead, pumped from BOTH a 60ms timer and a rAF loop — iOS
   * throttles whichever one it feels like, but rarely both at once, and
   * the wide lookahead rides out the gaps. If we ever fall behind (tab
   * frozen, long GC) we skip forward instead of burst-playing the gap.
   *
   * Three 4-bar songs (16th-note grid, 64 steps), picked per circuit.
   * The mix leans on mid/high harmonics (saws, octave doubles) because
   * phone speakers reproduce almost nothing below ~300Hz.
   */
  const PATTERN_LEN = 64;                   // 4 bars of 16ths
  const LOOKAHEAD = 0.3;

  const SONGS = [
    { // SUNSET RUN — Am F C G, bright and driving
      tempo: 144,
      roots: [110, 87.31, 130.81, 98],
      drive: false,
      lead: [
        440, 0, 523, 587, 659, 0, 587, 523,  440, 0, 523, 0, 659, 587, 523, 0,
        523, 0, 440, 0, 349, 0, 440, 523,    698, 0, 659, 587, 523, 0, 440, 0,
        523, 0, 587, 659, 784, 0, 659, 587,  523, 0, 659, 0, 784, 0, 1047, 0,
        494, 0, 587, 0, 784, 740, 659, 587,  494, 587, 659, 0, 587, 0, 494, 0,
      ],
    },
    { // HYPERDRIVE — C G Am F, the fastest and poppiest
      tempo: 152,
      roots: [130.81, 98, 110, 87.31],
      drive: true,
      lead: [
        523, 659, 784, 0, 1047, 0, 784, 659,  523, 0, 659, 784, 1047, 0, 1319, 0,
        494, 587, 784, 0, 988, 0, 784, 587,   494, 0, 587, 784, 988, 784, 587, 0,
        440, 523, 659, 0, 880, 0, 659, 523,   440, 0, 523, 659, 880, 0, 1047, 0,
        698, 0, 880, 698, 1047, 0, 880, 698,  784, 880, 1047, 0, 1319, 1047, 880, 0,
      ],
    },
    { // NIGHT CHASE — Dm Bb F C, tense but pushing forward
      tempo: 148,
      roots: [146.83, 116.54, 174.61, 130.81],
      drive: true,
      lead: [
        587, 0, 698, 587, 880, 0, 698, 587,   587, 698, 880, 0, 1175, 0, 880, 0,
        587, 0, 466, 0, 698, 587, 466, 0,     932, 0, 880, 698, 587, 0, 698, 0,
        698, 0, 880, 0, 1047, 880, 698, 0,    698, 880, 1047, 0, 1397, 0, 1047, 0,
        784, 0, 659, 784, 1047, 0, 784, 659,  587, 659, 784, 0, 880, 784, 698, 0,
      ],
    },
  ];

  let songIdx = 0;
  let stepDur = 60 / SONGS[0].tempo / 4;    // one 16th note for the song

  function setSong(i) {
    const next = ((i % SONGS.length) + SONGS.length) % SONGS.length;
    if (next === songIdx && musicOn) return;
    songIdx = next;
    stepDur = 60 / SONGS[songIdx].tempo / 4;
    if (musicOn) {                          // restart re-synced on the new song
      stopMusic();
      startMusic();
    }
  }

  let nextNoteT = 0;

  function musicNote(freq, type, peak, dur, t0) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function kick(t0) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.1);
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.2);
    // click transient so the beat reads on small speakers
    const len = Math.ceil(ctx.sampleRate * 0.02);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.18, t0);
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.025);
    src.connect(cg).connect(master);
    src.start(t0);
  }

  function hat(t0, open) {
    const len = Math.ceil(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(open ? 0.16 : 0.09, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (open ? 0.06 : 0.03));
    src.connect(f).connect(g).connect(master);
    src.start(t0);
  }

  let notesScheduled = 0;   // diagnostics: proves the sequencer is alive

  function snare(t0) {
    const len = Math.ceil(ctx.sampleRate * 0.1);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    // body thump
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, t0);
    og.gain.setValueAtTime(0.15, t0);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
    osc.connect(og).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.1);
  }

  function playStep(i, t0) {
    notesScheduled++;
    const song = SONGS[songIdx];
    const bar = Math.floor(i / 16);
    const root = song.roots[bar];

    if (i % 2 === 0) {                       // bass on eighths, octave bounce
      const f = (i % 4 === 2) ? root * 2 : root;
      // saws + octave double: harmonics survive a phone speaker
      musicNote(f, "sawtooth", 0.20, stepDur * 1.8, t0);
      musicNote(f * 2, "square", 0.10, stepDur * 1.6, t0);
    }
    if (i % 4 === 0) kick(t0);
    if (i % 8 === 4) snare(t0);              // backbeat
    if (i % 4 === 2) hat(t0, i % 16 === 14);
    if (song.drive && i % 2 === 1) hat(t0, false); // 16th drive on fast songs
    const lead = song.lead[i];
    if (lead) {
      musicNote(lead, "sawtooth", 0.15, stepDur * 2.4, t0);
      musicNote(lead * 1.005, "sawtooth", 0.09, stepDur * 2.4, t0); // detune shimmer
    }
    if (i % 16 === 0) {                      // soft pad chord on bar starts
      musicNote(root * 4, "triangle", 0.06, stepDur * 14, t0);
      musicNote(root * 4 * 1.1892, "triangle", 0.06, stepDur * 14, t0); // minor 3rd
    }
  }

  function scheduler() {
    if (!musicOn || !ctx) return;
    const now = ctx.currentTime;
    if (nextNoteT < now - 0.25) {
      // fell badly behind (frozen tab, long GC): jump ahead, stay on beat
      const missed = Math.ceil((now + 0.05 - nextNoteT) / stepDur);
      nextNoteT += missed * stepDur;
      step += missed;
    }
    while (nextNoteT < now + LOOKAHEAD) {
      playStep(step % PATTERN_LEN, nextNoteT);
      nextNoteT += stepDur;
      step++;
    }
  }

  function rafPump() {
    if (!musicOn) return;
    scheduler();
    window.requestAnimationFrame(rafPump);
  }

  function startMusic() {
    if (!ctx || musicOn) return;
    if (ctx.state !== "running") ctx.resume();
    if (musicTimer) clearInterval(musicTimer);
    musicOn = true;
    step = 0;
    nextNoteT = ctx.currentTime + 0.06;
    musicTimer = setInterval(scheduler, 60);
    if (window.requestAnimationFrame) window.requestAnimationFrame(rafPump);
  }

  function stopMusic() {
    musicOn = false;
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  }

  // one-line health summary for the on-screen indicator
  function status() {
    if (!ctx) return "tap to start";
    let s = ctx.state + " · " + outRoute;
    if (muted) s += " · muted";
    if (musicOn) s += " · ♪" + notesScheduled;
    return s;
  }

  return {
    init,
    status,
    setMuted,
    get muted() { return muted; },
    startEngine,
    stopEngine,
    setEngine,
    setSkid,
    coin,
    boostPad,
    driftBoost,
    skid,
    hitCone,
    oilSlip,
    bonk,
    countdown,
    lap,
    finish,
    uiSelect,
    itemGet,
    fireMissile,
    explosion,
    dropOil,
    jump,
    land,
    startMusic,
    stopMusic,
    setSong,
    get songCount() { return SONGS.length; },
  };
})();
