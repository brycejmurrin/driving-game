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

  // Engine voice (persistent while racing)
  let engOsc1 = null, engOsc2 = null, engFilter = null, engGain = null;
  let engineOn = false;

  // Music sequencer
  let musicOn = false;
  let musicTimer = null;
  let step = 0;

  function init() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.8;
    master.connect(ctx.destination);
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

  /* ---------------- music ---------------- */

  // Two-bar synthwave vamp: Am — F. Bass on eighths, arp on top.
  const BASS = [110, 110, 110, 110, 87.3, 87.3, 87.3, 87.3];
  const ARP = [440, 523, 659, 523, 349, 440, 523, 440];

  function tick() {
    if (!musicOn || !ctx) return;
    const i = step % 8;
    blip(BASS[i], "triangle", 0.16, 0.01, 0.16);
    blip(ARP[i], "square", 0.05, 0.01, 0.1);
    if (i === 0 || i === 4) noise(0.06, 0.05, 5000); // hat-ish accent
    step++;
  }

  function startMusic() {
    if (!ctx || musicOn) return;
    musicOn = true;
    step = 0;
    musicTimer = setInterval(tick, 170);
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
    startMusic,
    stopMusic,
  };
})();
