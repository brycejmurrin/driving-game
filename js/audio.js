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
  let unmuteEl = null;      // silent <audio> keeping iOS in playback mode

  // Engine voice (persistent while racing)
  let engOsc1 = null, engOsc2 = null, engFilter = null, engGain = null;
  let engineOn = false;

  // Music sequencer
  let musicOn = false;
  let musicTimer = null;
  let step = 0;

  let listenersAttached = false;
  let rebuildTries = 0;

  function createCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);

    // A fresh context often starts suspended even inside a tap (iOS) —
    // resume it and play one silent sample, the canonical unlock.
    if (ctx.state !== "running") ctx.resume();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    return true;
  }

  function init() {
    if (ctx) {
      resumeIfNeeded();
      return;
    }
    if (!createCtx()) return;

    if (!listenersAttached) {
      listenersAttached = true;

      // iPhone mutes WebAudio with the ringer/silent switch unless the
      // page is also playing an <audio> element, which promotes the audio
      // session to media playback. Loop a tiny silent wav forever.
      unmuteEl = document.createElement("audio");
      unmuteEl.loop = true;
      unmuteEl.setAttribute("playsinline", "");
      unmuteEl.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
      unmuteEl.play().catch(function () {});

      // iOS suspends the context on lock/app-switch and never resumes it
      // by itself; recover on the next gesture or on returning to the tab.
      window.addEventListener("touchend", resumeIfNeeded, true);
      window.addEventListener("pointerdown", resumeIfNeeded, true);
      window.addEventListener("keydown", resumeIfNeeded, true);
      document.addEventListener("visibilitychange", onVisibility);
    }
  }

  function resumeIfNeeded() {
    if (!ctx || ctx.state === "running") return;
    ctx.resume();
    // iOS can leave a context permanently stuck (after a phone call,
    // an "interrupted" state, or a hardware sample-rate change). If
    // resume doesn't take, throw the context away and rebuild it.
    setTimeout(function () {
      if (ctx && ctx.state !== "running" && rebuildTries < 3) {
        rebuildTries++;
        rebuildCtx();
      }
    }, 400);
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
    engineOn = true;
  }

  function stopEngine() {
    if (!engineOn) return;
    const t0 = now();
    engGain.gain.linearRampToValueAtTime(0, t0 + 0.2);
    engOsc1.stop(t0 + 0.3);
    engOsc2.stop(t0 + 0.3);
    engineOn = false;
  }

  // speed01: 0..1, boosting / offroad shape the tone
  function setEngine(speed01, boosting, offroad) {
    if (!engineOn) return;
    const base = 50 + speed01 * 170 + (boosting ? 40 : 0);
    engOsc1.frequency.value = base;
    engOsc2.frequency.value = base * 1.012 + (offroad ? 7 : 0);
    engFilter.frequency.value = 280 + speed01 * 1400 + (boosting ? 800 : 0);
    engGain.gain.value = 0.05 + speed01 * 0.075 + (offroad ? 0.02 : 0);
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

  /* ---------------- music ---------------- */

  /*
   * Lookahead sequencer: a JS timer wakes every 25ms and schedules any
   * notes that fall within the next 120ms on the WebAudio clock, so
   * playback stays sample-accurate even when the main thread hiccups.
   * Four-bar synthwave loop in A minor: Am — Am — F — G.
   */
  const TEMPO = 132;
  const STEP_DUR = 60 / TEMPO / 4;          // one 16th note
  const PATTERN_LEN = 64;                   // 4 bars of 16ths

  // chord roots per bar (A2, A2, F2, G2)
  const ROOTS = [110, 110, 87.31, 98];

  // lead melody, one entry per 16th (0 = rest), repeats every 4 bars
  const LEAD = [
    440, 0, 523, 0, 659, 0, 523, 659,  880, 0, 659, 0, 523, 0, 440, 0,
    440, 0, 523, 0, 659, 0, 880, 0,    784, 659, 523, 0, 659, 0, 0, 0,
    349, 0, 440, 0, 523, 0, 440, 523,  698, 0, 523, 0, 440, 0, 349, 0,
    392, 0, 494, 0, 587, 0, 494, 587,  784, 0, 587, 740, 784, 0, 880, 0,
  ];

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
    osc.frequency.setValueAtTime(130, t0);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.1);
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.2);
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

  function playStep(i, t0) {
    const bar = Math.floor(i / 16);
    const root = ROOTS[bar];

    if (i % 2 === 0) {                       // bass on eighths, octave bounce
      const f = (i % 4 === 2) ? root * 2 : root;
      musicNote(f, "triangle", 0.30, STEP_DUR * 1.8, t0);
      musicNote(f, "square", 0.07, STEP_DUR * 1.6, t0);
    }
    if (i % 4 === 0) kick(t0);
    if (i % 4 === 2) hat(t0, i % 16 === 14);
    const lead = LEAD[i];
    if (lead) musicNote(lead, "sawtooth", 0.10, STEP_DUR * 2.2, t0);
    if (i % 16 === 0) {                      // soft pad chord on bar starts
      musicNote(root * 4, "triangle", 0.05, STEP_DUR * 14, t0);
      musicNote(root * 4 * 1.1892, "triangle", 0.05, STEP_DUR * 14, t0); // minor 3rd
    }
  }

  function scheduler() {
    if (!musicOn || !ctx) return;
    while (nextNoteT < ctx.currentTime + 0.12) {
      playStep(step % PATTERN_LEN, nextNoteT);
      nextNoteT += STEP_DUR;
      step++;
    }
  }

  function startMusic() {
    if (!ctx || musicOn) return;
    if (ctx.state === "suspended") ctx.resume();
    musicOn = true;
    step = 0;
    nextNoteT = ctx.currentTime + 0.06;
    musicTimer = setInterval(scheduler, 25);
  }

  function stopMusic() {
    musicOn = false;
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  }

  return {
    init,
    setMuted,
    get muted() { return muted; },
    startEngine,
    stopEngine,
    setEngine,
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
    startMusic,
    stopMusic,
  };
})();
