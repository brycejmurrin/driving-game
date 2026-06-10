/*
 * Neon Drift — kart racing with gyro tilt steering.
 *
 * The world is a classic segmented pseudo-3D road (OutRun-style): the
 * track is a loop of fixed-length segments with per-segment curve and
 * elevation, projected each frame from the camera with accumulated
 * curvature. Everything on screen is solid triangles from renderer.js.
 */
"use strict";

(function () {
  /* ---------------- constants ---------------- */

  const SEG_LEN = Tracks.SEG_LEN;
  const ROAD_W = 1100;            // world half-width of the road
  const CAM_H = 1050;             // camera height above the road
  const CAM_DEPTH = 0.84;         // 1 / tan(fov/2)
  const DRAW_SEG = 110;           // draw distance in segments

  const MAX_SPEED = 7200;         // world units / second
  const BOOST_MULT = 1.32;
  const STEER_RATE = 1.7;         // road half-widths per second at full lock
  const CENTRIF = 0.235;          // centrifugal pull per unit curve

  const KART_COLORS = [
    [0.20, 0.95, 1.00],           // player — cyan
    [1.00, 0.30, 0.55],
    [0.65, 0.40, 1.00],
    [1.00, 0.75, 0.20],
    [0.30, 1.00, 0.55],
    [1.00, 0.45, 0.15],
  ];
  const AI_NAMES = ["VEX", "NOVA", "JINX", "RAZOR", "ECHO"];
  const POS_BONUS = [1200, 900, 650, 450, 300, 200];
  const POS_LABEL = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

  /* ---------------- DOM ---------------- */

  const canvas = document.getElementById("game");
  const elScore = document.getElementById("score");
  const elHiscore = document.getElementById("hiscore");
  const elLap = document.getElementById("lap");
  const elPos = document.getElementById("pos");
  const overlay = document.getElementById("overlay");
  const elTitle = document.getElementById("title");
  const elSubtitle = document.getElementById("subtitle");
  const elPrompt = document.getElementById("prompt");
  const elAnnounce = document.getElementById("announce");
  const pauseBtn = document.getElementById("pausebtn");
  const pauseMenu = document.getElementById("pausemenu");
  const trackSelect = document.getElementById("trackselect");
  const fireBtn = document.getElementById("firebtn");
  const driftBtn = document.getElementById("driftbtn");
  const steerLBtn = document.getElementById("steerleft");
  const steerRBtn = document.getElementById("steerright");
  const soundBtn = document.getElementById("soundbtn");
  const elAudioState = document.getElementById("audiostate");
  const helpBtn = document.getElementById("helpbtn");
  const howToPlay = document.getElementById("howtoplay");
  const howToPlayClose = document.getElementById("howtoplay-close");
  const isTouch = "ontouchstart" in window;

  if (!Renderer.init(canvas)) {
    document.getElementById("nogl").hidden = false;
    return;
  }
  const R = Renderer;

  /* ---------------- state ---------------- */

  let state = "menu";             // menu | select | count | race | results | gpend
  let paused = false;
  let track = null;               // current track def
  let segs = [];
  let trackLen = 0;
  let trackIdx = 0;
  let raceQueue = [0];            // track indices for this cup
  let queuePos = 0;
  let missiles = [];
  let mmPts = null;               // minimap outline, one point per segment

  let player = null;
  let cars = [];
  let racers = [];                // player + cars, for ranking

  let countT = 0;                 // countdown timer
  let countStep = 0;
  let raceT = 0;
  let finishT = 0;
  let demoZ = 0;
  let demoX = 0;

  let score = 0;                  // GP-total score
  let raceCoins = 0;
  let hiscore = Number(localStorage.getItem("neondrift.hiscore") || 0);
  let horizonY = 0;               // previous-frame horizon, for the sky

  let announceTimer = null;

  const stars = [];
  for (let i = 0; i < 70; i++) {
    stars.push({ x: Math.random(), y: Math.random() * 0.5, s: Math.random() * 1.6 + 0.6, p: Math.random() * 6 });
  }

  Input.useTilt = localStorage.getItem("neondrift.tilt") !== "off";
  GameAudio.setMuted(localStorage.getItem("neondrift.sound") === "off");

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function fade(c, f, a) { return [c[0] * f, c[1] * f, c[2] * f, a === undefined ? 1 : a]; }
  function mix(a, b, p) { return [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p), 1]; }

  function segAt(z) {
    return segs[Math.floor(z / SEG_LEN) % segs.length];
  }

  function roadY(z) {
    const seg = segAt(z);
    const p = (z % SEG_LEN) / SEG_LEN;
    return lerp(seg.y1, seg.y2, p);
  }

  function announce(text, ms) {
    elAnnounce.textContent = text;
    elAnnounce.classList.add("show");
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(function () {
      elAnnounce.classList.remove("show");
    }, ms || 1100);
  }

  function updateHud() {
    elScore.textContent = String(score + raceCoins * 25);
    elHiscore.textContent = String(hiscore);
    if (player && (state === "race" || state === "count" || state === "results")) {
      const lapNum = Math.min(track.laps, player.laps + 1);
      elLap.textContent = lapNum + "/" + track.laps;
      elPos.textContent = POS_LABEL[player.rank];
    } else {
      elLap.textContent = "-";
      elPos.textContent = "-";
    }
  }

  /* ---------------- race setup ---------------- */

  function makeRacer(isPlayer, idx, gridRow, gridCol) {
    return {
      isPlayer: isPlayer,
      name: isPlayer ? "YOU" : AI_NAMES[idx - 1],
      color: KART_COLORS[idx],
      z0: 400 + gridRow * 320,
      dist: 0,                    // distance traveled since start
      x: gridCol,                 // -1..1 in road half-widths
      speed: 0,
      laps: 0,                    // finish-line crossings completed
      rank: idx,
      finished: false,
      finishOrder: -1,
      // AI personality
      skill: 0.78 + idx * 0.035 + Math.random() * 0.05,
      lane: gridCol * 0.8,
      // effect timers (spinT is shared: missiles spin AI out too)
      boostT: 0, spinT: 0, slideT: 0, hopT: 0,
      driftCharge: 0, driftDir: 0, wasDrifting: false,
      steerVis: 0, driftVis: 0,
      airT: 0, airTotal: 1,            // ramp jumps
      weapon: null,
    };
  }

  function startRace(idx) {
    trackIdx = idx;
    track = Tracks.list[idx]();
    segs = track.segs;
    trackLen = segs.length * SEG_LEN;
    raceCoins = 0;
    raceT = 0;
    finishT = 0;
    missiles = [];
    buildMinimap();

    // grid: player starts at the back, AI staggered ahead
    player = makeRacer(true, 0, 0, 0.35);
    cars = [];
    for (let i = 1; i <= 5; i++) {
      cars.push(makeRacer(false, i, i, (i % 2 === 0 ? 1 : -1) * 0.35));
    }
    racers = [player].concat(cars);

    state = "count";
    countT = 0;
    countStep = 0;
    overlay.classList.add("hidden");
    howToPlay.hidden = true;
    helpBtn.hidden = true;
    trackSelect.hidden = true;
    pauseBtn.hidden = false;
    driftBtn.hidden = !isTouch;
    Input.reset();
    Input.calibrate();
    updateFireBtn();
    updateSoundBtn();
    announce(track.name, 1400);
    GameAudio.startEngine();
    GameAudio.setSong(idx);     // each circuit gets its own tune
    GameAudio.startMusic();
    updateHud();
  }

  /*
   * Minimap: integrate the per-segment curve into a heading and walk it
   * to get an outline. Pseudo-3D tracks don't geometrically close, so
   * the end-to-start error is distributed along the path to seal the loop.
   */
  function buildMinimap() {
    const n = segs.length;
    const pts = [];
    let heading = 0, x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      heading += segs[i].curve * 0.009;
      x += Math.sin(heading);
      y -= Math.cos(heading);
      pts.push({ x: x, y: y });
    }
    for (let i = 0; i < n; i++) {
      pts[i].x += -x * (i + 1) / n;
      pts[i].y += -y * (i + 1) / n;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const padX = (1 - (maxX - minX) / span) / 2;
    const padY = (1 - (maxY - minY) / span) / 2;
    mmPts = pts.map(function (p) {
      return { x: (p.x - minX) / span + padX, y: (p.y - minY) / span + padY };
    });
  }

  function drawMinimap() {
    if (!mmPts || !player) return;
    const size = Math.min(R.width, R.height) * 0.22;
    const mx = 12, my = 58;
    const g = track.palette.glow;
    for (let i = 0; i < mmPts.length; i += 3) {
      const p = mmPts[i];
      R.quad(mx + p.x * size - 1, my + p.y * size - 1, 2, 2, [g[0], g[1], g[2], 0.4]);
    }
    const s0 = mmPts[6];
    R.quad(mx + s0.x * size - 2, my + s0.y * size - 2, 4, 4, [1, 1, 1, 0.9]);
    for (const c of cars) {
      const p = mmPts[Math.floor(zOf(c) / SEG_LEN) % mmPts.length];
      R.circle(mx + p.x * size, my + p.y * size, 2.4, [c.color[0], c.color[1], c.color[2], 1], 6);
    }
    const pp = mmPts[Math.floor(zOf(player) / SEG_LEN) % mmPts.length];
    R.circle(mx + pp.x * size, my + pp.y * size, 3.8, [1, 1, 1, 1], 8);
    R.circle(mx + pp.x * size, my + pp.y * size, 2.3, [0.2, 0.95, 1.0, 1], 8);
  }

  function zOf(r) { return (r.z0 + r.dist) % trackLen; }
  function progress(r) { return r.z0 + r.dist; }
  function lapsOf(r) { return Math.floor(progress(r) / trackLen); }

  function rankRacers() {
    const order = racers.slice().sort(function (a, b) {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
      return progress(b) - progress(a);
    });
    let nextOrder = 0;
    for (const r of order) if (r.finished) nextOrder = Math.max(nextOrder, r.finishOrder + 1);
    for (let i = 0; i < order.length; i++) order[i].rank = i;
    return nextOrder;
  }

  /* ---------------- player physics ---------------- */

  function updatePlayer(dt) {
    const p = player;
    const seg = segAt(zOf(p));
    const speedPct = p.speed / MAX_SPEED;

    if (Input.consumeFire() && state === "race" && !p.finished) fireWeapon();

    // airborne after a ramp: fly over hazards, limited control
    const wasAir = p.airT > 0;
    if (p.airT > 0) p.airT -= dt;
    const airborne = p.airT > 0;
    if (wasAir && !airborne) GameAudio.land();

    // throttle: automatic. Effects shape the target speed.
    let target = MAX_SPEED;
    if (p.boostT > 0) target *= BOOST_MULT;
    if (Math.abs(p.x) > 1.04 && !airborne) target = MAX_SPEED * 0.35;  // off-road
    if (p.spinT > 0) target = MAX_SPEED * 0.2;
    if (Input.braking()) target = MAX_SPEED * 0.25;
    const k = p.speed > target ? 2.6 : (p.boostT > 0 ? 2.2 : 0.85);
    p.speed += (target - p.speed) * Math.min(1, k * dt);

    // steering
    let steer = state === "race" && !p.finished ? Input.steer() : autoSteer(p);
    if (p.spinT > 0) steer = 0;
    if (p.slideT > 0) steer = steer * 0.3 + Math.sin(raceT * 9) * 0.7;
    p.steerVis += (steer - p.steerVis) * Math.min(1, 10 * dt);

    // drift: hold while turning fast to charge a boost
    const wantDrift = Input.drifting() && state === "race" && !p.finished;
    if (wantDrift && !p.wasDrifting && p.spinT <= 0) p.hopT = 0.18;
    const drifting = wantDrift && speedPct > 0.45 && Math.abs(steer) > 0.2 && p.spinT <= 0;
    if (drifting) {
      p.driftDir = Math.sign(steer);
      p.driftCharge += dt * Math.abs(steer);
    }
    GameAudio.setSkid(drifting ? 0.55 + 0.45 * Math.min(1, p.driftCharge) : 0);
    p.driftVis += ((drifting ? p.driftDir : 0) - p.driftVis) * Math.min(1, 9 * dt);
    if (!wantDrift) {
      if (p.wasDrifting && p.driftCharge > 0.6) {
        p.boostT = Math.max(p.boostT, p.driftCharge > 1.3 ? 1.5 : 0.9);
        GameAudio.driftBoost();
        announce("DRIFT BOOST!", 700);
      }
      p.driftCharge = 0;
    }
    p.wasDrifting = wantDrift;
    if (p.hopT > 0) p.hopT -= dt;

    const steerMult = (drifting ? 1.45 : 1.0) * (airborne ? 0.35 : 1.0);
    p.x += steer * STEER_RATE * steerMult * clamp(speedPct, 0.15, 1) * dt;
    p.x -= seg.curve * speedPct * speedPct * CENTRIF * (airborne ? 0.35 : 1.0) * dt;
    p.x = clamp(p.x, -1.7, 1.7);

    // advance
    const oldZ = zOf(p);
    const oldLaps = lapsOf(p);
    p.dist += p.speed * dt;
    checkItems(p, oldZ, p.speed * dt);
    checkKartCollisions(p, dt);

    // effect timers
    if (p.boostT > 0) p.boostT -= dt;
    if (p.spinT > 0) p.spinT -= dt;
    if (p.slideT > 0) p.slideT -= dt;

    // lap / finish
    const lapsNow = lapsOf(p);
    if (lapsNow > oldLaps && !p.finished) {
      p.laps = lapsNow;
      if (lapsNow >= track.laps) {
        playerFinish();
      } else if (lapsNow === track.laps - 1) {
        announce("FINAL LAP!", 1300);
        GameAudio.lap(true);
      } else {
        announce("LAP " + (lapsNow + 1) + "/" + track.laps, 1000);
        GameAudio.lap(false);
      }
    }

    GameAudio.setEngine(clamp(p.speed / (MAX_SPEED * BOOST_MULT), 0, 1),
      p.boostT > 0, Math.abs(p.x) > 1.04);
  }

  // gentle autopilot used after the player crosses the line
  function autoSteer(r) {
    const seg = segAt(zOf(r));
    const want = -Math.sign(seg.curve) * Math.min(0.4, Math.abs(seg.curve) * 0.12);
    return clamp((want - r.x) * 2.2, -1, 1);
  }

  function playerFinish() {
    player.finished = true;
    player.finishOrder = rankRacers();
    finishT = 0;
    const pos = player.finishOrder;
    announce(pos === 0 ? "FINISH!  YOU WIN!" : "FINISH!  " + POS_LABEL[pos], 2000);
    GameAudio.finish(pos <= 1);
    state = "results";
  }

  /* ---------------- items ---------------- */

  function checkItems(p, oldZ, moved) {
    const startSeg = Math.floor(oldZ / SEG_LEN);
    const n = Math.min(segs.length, Math.ceil(moved / SEG_LEN) + 1);
    for (let i = 0; i < n; i++) {
      const seg = segs[(startSeg + i) % segs.length];
      for (const item of seg.items) {
        if (!item.alive && item.type !== "pad") continue;
        const dx = Math.abs(item.x - p.x);
        switch (item.type) {
          case "coin":
            if (dx < 0.22) {
              item.alive = false;
              raceCoins++;
              GameAudio.coin();
            }
            break;
          case "pad":
            if (dx < 0.34 && p.airT <= 0) {
              if (p.boostT < 1.2) GameAudio.boostPad();
              p.boostT = Math.max(p.boostT, 1.3);
            }
            break;
          case "ramp":
            if (dx < 0.36 && p.airT <= 0 && p.speed > MAX_SPEED * 0.25) {
              p.airTotal = 0.45 + 0.5 * (p.speed / MAX_SPEED);
              p.airT = p.airTotal;
              GameAudio.jump();
            }
            break;
          case "cone":
            if (dx < 0.18 && p.spinT <= 0 && p.hopT <= 0 && p.airT <= 0) {
              item.alive = false;
              p.spinT = 0.9;
              p.boostT = 0;
              p.driftCharge = 0;
              GameAudio.hitCone();
            }
            break;
          case "oil":
            if (dx < 0.2 && p.slideT <= 0 && p.hopT <= 0 && p.airT <= 0) {
              p.slideT = 0.8;
              GameAudio.oilSlip();
            }
            break;
          case "box":
            if (dx < 0.28 && raceT > (item.deadUntil || 0) && !p.weapon) {
              item.deadUntil = raceT + 4;     // box respawns after 4s
              const roll = Math.random();
              p.weapon = roll < 0.45 ? "missile" : roll < 0.75 ? "boost" : "oil";
              updateFireBtn();
              GameAudio.itemGet();
            }
            break;
        }
      }
    }
  }

  /* ---------------- weapons ---------------- */

  const WEAPON_ICON = { missile: "\u{1F680}", boost: "⚡", oil: "\u{1F4A7}" };

  function updateFireBtn() {
    const racing = state === "race" || state === "count";
    const hasWeapon = !!(player && player.weapon);
    if (!isTouch) {
      // Desktop: always show during race so the button is discoverable
      fireBtn.hidden = !racing;
      fireBtn.textContent = hasWeapon ? WEAPON_ICON[player.weapon] : "FIRE";
      fireBtn.classList.toggle("no-weapon", !hasWeapon);
    } else {
      // Touch: only show when a weapon is loaded (icon is the cue to fire)
      fireBtn.hidden = !(hasWeapon && racing);
      if (hasWeapon) fireBtn.textContent = WEAPON_ICON[player.weapon];
      fireBtn.classList.remove("no-weapon");
    }
  }

  function fireWeapon() {
    const p = player;
    if (!p.weapon) return;
    switch (p.weapon) {
      case "boost":
        p.boostT = Math.max(p.boostT, 1.5);
        GameAudio.boostPad();
        break;
      case "missile":
        missiles.push({
          z: (zOf(p) + 350) % trackLen,
          x: p.x,
          speed: Math.max(p.speed + 3600, 8800),
          life: 4,
        });
        GameAudio.fireMissile();
        break;
      case "oil": {
        // drop a slick a couple of segments behind
        const idx = Math.floor(((zOf(p) - SEG_LEN * 2 + trackLen) % trackLen) / SEG_LEN);
        segs[idx].items.push({ type: "oil", x: clamp(p.x, -0.9, 0.9), alive: true, dropped: true });
        GameAudio.dropOil();
        break;
      }
    }
    p.weapon = null;
    updateFireBtn();
  }

  function updateMissiles(dt) {
    for (const m of missiles) {
      m.z = (m.z + m.speed * dt) % trackLen;
      m.life -= dt;
      if (m.life <= 0) continue;
      // gentle homing toward the nearest kart ahead
      let best = null, bestDz = 2600;
      for (const c of cars) {
        let dz = zOf(c) - m.z;
        if (dz < -trackLen / 2) dz += trackLen;
        if (dz > trackLen / 2) dz -= trackLen;
        if (dz > 0 && dz < bestDz) { best = c; bestDz = dz; }
      }
      if (best) m.x += clamp(best.x - m.x, -1, 1) * 1.6 * dt;
      for (const c of cars) {
        let dz = zOf(c) - m.z;
        if (dz < -trackLen / 2) dz += trackLen;
        if (dz > trackLen / 2) dz -= trackLen;
        if (Math.abs(dz) < 260 && Math.abs(c.x - m.x) < 0.32 && c.spinT <= 0) {
          c.spinT = 1.3;
          m.life = 0;
          GameAudio.explosion();
          announce("HIT " + c.name + "!", 800);
          break;
        }
      }
    }
    missiles = missiles.filter(function (m) { return m.life > 0; });
  }

  function checkKartCollisions(p, dt) {
    for (const c of cars) {
      let dz = zOf(c) - zOf(p);
      if (dz > trackLen / 2) dz -= trackLen;
      if (dz < -trackLen / 2) dz += trackLen;
      if (Math.abs(dz) < 320 && Math.abs(c.x - p.x) < 0.30) {
        if (dz > 0 && p.speed > c.speed) {        // rear-ended them
          p.speed = c.speed * 0.85;
          GameAudio.bonk();
        } else if (dz < 0 && c.speed > p.speed) { // they rear-ended us
          c.speed = p.speed * 0.85;
        }
        const push = Math.sign(p.x - c.x) || 1;
        p.x += push * 1.6 * dt;
        c.x -= push * 1.6 * dt;
      }
    }
  }

  /* ---------------- AI ---------------- */

  function updateCar(c, dt, raceStarted) {
    const z = zOf(c);
    const seg = segAt(z);
    const ahead = segAt(z + SEG_LEN * 12);

    // spun out (player missile, dropped oil): coast and recover
    if (c.spinT > 0) {
      c.spinT -= dt;
      c.speed += (MAX_SPEED * 0.15 - c.speed) * Math.min(1, 3 * dt);
      const oldL = lapsOf(c);
      c.dist += c.speed * dt;
      if (lapsOf(c) > oldL) c.laps = lapsOf(c);
      return;
    }
    if (c.airT > 0) c.airT -= dt;
    for (const item of seg.items) {
      if (item.dropped && item.type === "oil" && Math.abs(item.x - c.x) < 0.22 && c.airT <= 0) {
        c.spinT = 0.9;
        return;
      }
      if (item.type === "ramp" && Math.abs(item.x - c.x) < 0.36 && c.airT <= 0 &&
          c.speed > MAX_SPEED * 0.25) {
        c.airTotal = 0.5;
        c.airT = 0.5;
      }
    }

    // rubber-banding keeps the pack near the player
    let band = 1;
    if (!c.finished && !player.finished) {
      const rel = progress(player) - progress(c);
      band = clamp(1 + rel / (trackLen * 0.45) * 0.12, 0.9, 1.12);
    }
    let target = raceStarted ? MAX_SPEED * c.skill * band : 0;
    target *= 1 - Math.min(0.4, Math.abs(ahead.curve) * 0.055 * (2 - c.skill));
    for (const item of seg.items) {
      if (item.type === "pad" && Math.abs(item.x - c.x) < 0.34) target *= 1.18;
    }
    c.speed += (target - c.speed) * Math.min(1, 0.9 * dt);

    // steering: hug the inside of upcoming curves, dodge other karts
    let want = Math.abs(ahead.curve) > 1.5
      ? -Math.sign(ahead.curve) * 0.4
      : c.lane * 0.5;
    for (const o of racers) {
      if (o === c) continue;
      let dz = zOf(o) - z;
      if (dz > trackLen / 2) dz -= trackLen;
      if (dz < -trackLen / 2) dz += trackLen;
      if (dz > 0 && dz < 900 && Math.abs(o.x - c.x) < 0.35) {
        want = c.x + (c.x > o.x ? 0.45 : -0.45);
      }
    }
    c.x += clamp(want - c.x, -1, 1) * 1.1 * dt;
    c.x -= seg.curve * Math.pow(c.speed / MAX_SPEED, 2) * CENTRIF * 0.5 * dt;
    c.x = clamp(c.x, -0.9, 0.9);

    const oldLaps = lapsOf(c);
    c.dist += c.speed * dt;
    if (lapsOf(c) > oldLaps) {
      c.laps = lapsOf(c);
      if (c.laps >= track.laps && !c.finished) {
        c.finished = true;
        c.finishOrder = rankRacers();
      }
    }
  }

  /* ---------------- results / flow ---------------- */

  function showResults() {
    // everyone still on track finishes by current order
    rankRacers();
    const order = racers.slice().sort(function (a, b) { return a.rank - b.rank; });
    const pos = player.rank;
    score += raceCoins * 25 + POS_BONUS[pos];
    if (score > hiscore) {
      hiscore = score;
      localStorage.setItem("neondrift.hiscore", String(hiscore));
    }

    let lines = "";
    for (let i = 0; i < order.length; i++) {
      lines += POS_LABEL[i] + "  " + order[i].name + (order[i].isPlayer ? "  ◀" : "") + "\n";
    }
    lines += "\ncoins " + raceCoins + " × 25  +  " + POS_BONUS[pos] + " place bonus";

    const last = queuePos === raceQueue.length - 1;
    const cup = raceQueue.length > 1;
    elTitle.textContent = last
      ? (cup ? "GRAND PRIX COMPLETE" : "RACE COMPLETE")
      : "RACE " + (queuePos + 1) + "/" + raceQueue.length + " DONE";
    elSubtitle.textContent = lines + (last && cup ? "\n\nGP SCORE  " + score : "");
    elPrompt.textContent = last ? "TAP FOR MENU" : "TAP FOR NEXT RACE";
    overlay.classList.remove("hidden");
    state = last ? "gpend" : "results";
    fireBtn.hidden = true;
    driftBtn.hidden = true;
    GameAudio.stopEngine();
    updateHud();
  }

  function toMenu() {
    state = "menu";
    score = 0;
    raceCoins = 0;
    track = Tracks.list[0]();
    segs = track.segs;
    trackLen = segs.length * SEG_LEN;
    demoZ = 0;
    demoX = 0;
    player = null;
    cars = [];
    missiles = [];
    pauseBtn.hidden = true;
    fireBtn.hidden = true;
    driftBtn.hidden = true;
    trackSelect.hidden = true;
    GameAudio.stopEngine();
    elTitle.textContent = "NEON DRIFT";
    elSubtitle.textContent = tiltHint();
    elPrompt.textContent = "TAP TO START";
    overlay.classList.remove("hidden");
    updateSoundBtn();
    updateHelpBtn();
    updateHud();
  }

  function tiltHint() {
    if (Input.gyroSeen && Input.useTilt) return "Tilt your phone to steer\nHold DRIFT through corners · release for boost\nGrab ? boxes · fire with the weapon button";
    if (Input.gyroDenied) return "Touch left / right to steer\nHold DRIFT through corners · release for boost\nGrab ? boxes · fire with the weapon button";
    return "Tilt your phone to steer · drift for boosts\n? boxes hold weapons · 3 laps · 5 rivals";
  }

  function showSelect() {
    state = "select";
    elTitle.textContent = "SELECT CIRCUIT";
    elSubtitle.textContent = "";
    elPrompt.textContent = "";
    if (!trackSelect.childElementCount) buildTrackButtons();
    trackSelect.hidden = false;
    overlay.classList.remove("hidden");
    updateSoundBtn();
    updateHelpBtn();
  }

  function buildTrackButtons() {
    const gp = document.createElement("button");
    gp.className = "gp";
    gp.textContent = "GRAND PRIX — ALL CIRCUITS";
    gp.addEventListener("click", function (e) {
      e.stopPropagation();
      pickTracks(Tracks.list.map(function (_, i) { return i; }));
    });
    trackSelect.appendChild(gp);
    Tracks.meta.forEach(function (m, i) {
      const b = document.createElement("button");
      b.textContent = m.name;
      b.style.setProperty("--accent", m.color);
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        pickTracks([i]);
      });
      trackSelect.appendChild(b);
    });
  }

  function pickTracks(queue) {
    GameAudio.uiSelect();
    raceQueue = queue;
    queuePos = 0;
    score = 0;
    startRace(raceQueue[0]);
  }

  /* ---------------- start / pause wiring ---------------- */

  function onStartTap() {
    GameAudio.init();
    GameAudio.uiSelect();
    GameAudio.startMusic();
    if (state === "menu") {
      // gyro permission must be requested inside this gesture (iOS)
      Input.requestGyro();
      showSelect();
    } else if (state === "results") {
      queuePos++;
      startRace(raceQueue[queuePos]);
    } else if (state === "gpend") {
      toMenu();
    }
  }

  overlay.addEventListener("click", function (e) {
    if (e.target.tagName === "BUTTON") return;   // track buttons handle themselves
    onStartTap();
  });
  overlay.addEventListener("touchend", function (e) {
    if (e.target.tagName === "BUTTON") return;
    e.preventDefault();
    onStartTap();
  });
  window.addEventListener("keydown", function (e) {
    if ((e.code === "Enter" || e.code === "Space") && !overlay.classList.contains("hidden")) {
      if (state === "menu" || state === "results" || state === "gpend") onStartTap();
    }
  });

  function setPaused(v) {
    if (state !== "race" && state !== "count") return;
    paused = v;
    pauseMenu.hidden = !v;
    if (v) GameAudio.stopEngine(); else GameAudio.startEngine();
    refreshPauseLabels();
  }

  function refreshPauseLabels() {
    document.getElementById("pm-tilt").textContent =
      "TILT: " + (Input.useTilt ? (Input.gyroSeen ? "ON" : "ON (NO GYRO)") : "OFF");
    document.getElementById("pm-sound").textContent =
      "SOUND: " + (GameAudio.muted ? "OFF" : "ON");
  }

  pauseBtn.addEventListener("click", function () { setPaused(true); });
  document.getElementById("pm-resume").addEventListener("click", function () { setPaused(false); });
  document.getElementById("pm-restart").addEventListener("click", function () {
    paused = false;
    pauseMenu.hidden = true;
    startRace(trackIdx);
  });
  document.getElementById("pm-tilt").addEventListener("click", function () {
    Input.useTilt = !Input.useTilt;
    localStorage.setItem("neondrift.tilt", Input.useTilt ? "on" : "off");
    refreshPauseLabels();
  });
  document.getElementById("pm-calib").addEventListener("click", function () {
    Input.calibrate();
    GameAudio.uiSelect();
  });
  document.getElementById("pm-sound").addEventListener("click", function () {
    GameAudio.setMuted(!GameAudio.muted);
    localStorage.setItem("neondrift.sound", GameAudio.muted ? "off" : "on");
    refreshPauseLabels();
  });
  document.getElementById("pm-quit").addEventListener("click", function () {
    paused = false;
    pauseMenu.hidden = true;
    toMenu();
  });
  Input.init(canvas, { onPause: function () { setPaused(!paused); } });

  // on-screen weapon + drift buttons
  function bindHold(btn, on, off) {
    btn.addEventListener("touchstart", function (e) { e.preventDefault(); on(); }, { passive: false });
    btn.addEventListener("touchend", function (e) { e.preventDefault(); off(); }, { passive: false });
    btn.addEventListener("touchcancel", function () { off(); });
    btn.addEventListener("mousedown", on);
    btn.addEventListener("mouseup", off);
    btn.addEventListener("mouseleave", off);
  }
  bindHold(driftBtn, function () {
    Input.setButtonDrift(true);
    driftBtn.classList.add("held");
  }, function () {
    Input.setButtonDrift(false);
    driftBtn.classList.remove("held");
  });
  fireBtn.addEventListener("touchstart", function (e) { e.preventDefault(); Input.pressFire(); }, { passive: false });
  fireBtn.addEventListener("mousedown", function () { Input.pressFire(); });

  // sound toggle on the title/select screens; plays a chime as proof of life
  function updateSoundBtn() {
    soundBtn.hidden = !(state === "menu" || state === "select");
    soundBtn.textContent = "♪ " + (GameAudio.muted ? "OFF" : "ON");
    soundBtn.classList.toggle("off", GameAudio.muted);
  }

  function updateHelpBtn() {
    helpBtn.hidden = !(state === "menu" || state === "select");
  }

  function openHowToPlay(e) {
    if (e) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }
    howToPlay.hidden = false;
  }
  function closeHowToPlay(e) {
    if (e) { e.stopPropagation(); if (e.cancelable) e.preventDefault(); }
    howToPlay.hidden = true;
  }
  helpBtn.addEventListener("click", openHowToPlay);
  helpBtn.addEventListener("touchend", openHowToPlay);
  howToPlayClose.addEventListener("click", closeHowToPlay);
  howToPlayClose.addEventListener("touchend", closeHowToPlay);
  function onSoundToggle(e) {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    GameAudio.init();
    GameAudio.setMuted(!GameAudio.muted);
    localStorage.setItem("neondrift.sound", GameAudio.muted ? "off" : "on");
    if (!GameAudio.muted) GameAudio.coin();
    updateSoundBtn();
    refreshPauseLabels();
  }
  soundBtn.addEventListener("click", onSoundToggle);
  soundBtn.addEventListener("touchend", onSoundToggle);

  // ◀ ▶ arrow steering, shown when tilt isn't doing the steering
  let steerLHeld = false, steerRHeld = false;
  function applySteerButtons() {
    Input.setButtonSteer((steerRHeld ? 1 : 0) - (steerLHeld ? 1 : 0));
    steerLBtn.classList.toggle("held", steerLHeld);
    steerRBtn.classList.toggle("held", steerRHeld);
  }
  bindHold(steerLBtn, function () { steerLHeld = true; applySteerButtons(); },
                      function () { steerLHeld = false; applySteerButtons(); });
  bindHold(steerRBtn, function () { steerRHeld = true; applySteerButtons(); },
                      function () { steerRHeld = false; applySteerButtons(); });

  function syncSteerButtons() {
    const racing = state === "race" || state === "count";
    const show = racing && isTouch && !Input.tiltActive();
    if (steerLBtn.hidden === show) {
      steerLBtn.hidden = !show;
      steerRBtn.hidden = !show;
      document.body.classList.toggle("btnsteer", show);
    }
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    syncSteerButtons();
    if (state === "menu" || state === "select") {
      elAudioState.textContent = "audio: " + GameAudio.status();
      demoZ = (demoZ + MAX_SPEED * 0.45 * dt) % trackLen;
      const seg = segAt(demoZ);
      demoX += ((-seg.curve * 0.12) - demoX) * dt * 2;
      return;
    }

    if (state === "count") {
      countT += dt;
      const stepNow = Math.floor(countT);
      if (stepNow > countStep) {
        countStep = stepNow;
        if (countStep <= 3) {
          announce(String(4 - countStep), 700);
          GameAudio.countdown(false);
          if (countStep === 1) Input.calibrate(); // phone held naturally now
        }
      }
      if (countT >= 4) {
        announce("GO!", 800);
        GameAudio.countdown(true);
        state = "race";
      }
      GameAudio.setEngine(0.15 + 0.1 * Math.sin(countT * 10), false, false);
      return;
    }

    if (state === "race" || state === "results" || state === "gpend") {
      raceT += dt;
      if (player) {
        updatePlayer(dt);
        for (const c of cars) updateCar(c, dt, true);
        updateMissiles(dt);
        rankRacers();
        if (state === "results" && overlay.classList.contains("hidden")) {
          finishT += dt;
          if (finishT > 2.2) showResults();
        }
        updateHud();
      }
    }
  }

  /* ---------------- rendering ---------------- */

  const proj = [];                // per-frame projected segment edges
  for (let i = 0; i <= DRAW_SEG; i++) proj.push({ x: 0, y: 0, w: 0, scale: 0 });

  function drawSky(pal, curveAccum, camXNorm) {
    const w = R.width, h = R.height;
    const hy = clamp(horizonY, h * 0.2, h * 0.75);
    // vertical gradient in bands
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const c = mix(pal.skyTop, pal.skyBot, i / (bands - 1));
      R.quad(0, (hy * i) / bands, w, hy / bands + 1, c);
    }
    R.quad(0, hy, w, h - hy, pal.groundA); // below-horizon fill

    // stars
    for (const s of stars) {
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(raceT * 1.5 + s.p));
      R.quad(s.x * w, s.y * hy, s.s, s.s, [1, 1, 1, 0.7 * tw]);
    }

    // retro sun, shifted opposite the curve for parallax
    const sx = w / 2 - clamp(curveAccum * 0.45, -w * 0.35, w * 0.35) - camXNorm * 30;
    const sy = hy - h * 0.02;
    const r = Math.min(w, h) * 0.16;
    R.circle(sx, sy, r * 1.25, fade(pal.sun, 1, 0.18), 24);
    R.circle(sx, sy, r, mix(pal.sun, pal.sun, 0), 24);
    R.circle(sx, sy, r * 0.985, pal.sunLo, 24);
    R.circle(sx, sy - r * 0.45, r * 0.8, pal.sun, 20);
    // horizontal slice cuts
    for (let i = 0; i < 4; i++) {
      const yy = sy - r * 0.25 + i * r * 0.22;
      R.quad(sx - r * 1.1, yy, r * 2.2, r * (0.035 + i * 0.012), mix(pal.skyTop, pal.skyBot, 0.85));
    }
    // horizon glow line
    R.quad(0, hy - 2, w, 3, fade(pal.glow, 1, 0.6));
  }

  function renderWorld(camZ, camXNorm, showPlayer) {
    const w = R.width, h = R.height;
    const pal = track.palette;
    const baseIdx = Math.floor(camZ / SEG_LEN);
    const basePct = (camZ % SEG_LEN) / SEG_LEN;
    const camY = CAM_H + roadY(camZ);
    const camX = camXNorm * ROAD_W;

    const baseSeg = segs[baseIdx % segs.length];
    let xAcc = 0;                               // road-center world x at near edge
    let dxAcc = -(baseSeg.curve * basePct);
    let curveTotal = 0;

    // project all edges first
    let clipY = h;
    let drawn = 0;
    for (let n = 0; n <= DRAW_SEG; n++) {
      const seg = segs[(baseIdx + n) % segs.length];
      const dz = (n - basePct) * SEG_LEN;
      const pr = proj[n];
      if (dz < SEG_LEN * 0.4) {
        // behind / at the camera: pin to the bottom of the screen
        pr.scale = CAM_DEPTH / (SEG_LEN * 0.4);
        pr.x = w / 2 + pr.scale * (xAcc - camX) * (w / 2);
        pr.y = h + 5;
        pr.w = pr.scale * ROAD_W * (w / 2);
      } else {
        pr.scale = CAM_DEPTH / dz;
        pr.x = w / 2 + pr.scale * (xAcc - camX) * (w / 2);
        pr.y = h / 2 - pr.scale * (seg.y1 - camY) * (h / 2);
        pr.w = pr.scale * ROAD_W * (w / 2);
      }
      xAcc += dxAcc;
      dxAcc += seg.curve;
      if (n < DRAW_SEG * 0.7) curveTotal += seg.curve;
    }

    // draw road front to back, clipping against the rising horizon
    let newHorizon = h * 0.45;
    for (let n = 0; n < DRAW_SEG; n++) {
      const seg = segs[(baseIdx + n) % segs.length];
      const p1 = proj[n], p2 = proj[n + 1];
      if (p2.y >= clipY) continue;            // hidden behind a crest
      if (p1.y < 0 && p2.y < 0) break;
      const fog = Math.pow(n / DRAW_SEG, 1.6) * 0.92;
      const alt = Math.floor((baseIdx + n) / 3) % 2 === 0;

      const yTop = p2.y, yBot = Math.min(p1.y, clipY);
      if (yBot - yTop > 0.1) {
        // ground band across the whole screen
        const ground = mix(alt ? pal.groundA : pal.groundB, pal.skyBot, fog * 0.5);
        R.quad(0, yTop, w, yBot - yTop + 1, ground);

        // rumble strips
        const rumble = mix(alt ? pal.rumbleA : pal.rumbleB, pal.skyBot, fog);
        R.quadP(p2.x - p2.w * 1.12, p2.y, p2.x + p2.w * 1.12, p2.y,
                p1.x + p1.w * 1.12, p1.y, p1.x - p1.w * 1.12, p1.y, rumble);

        // road body
        const road = mix(alt ? pal.roadA : pal.roadB, pal.skyBot, fog);
        R.quadP(p2.x - p2.w, p2.y, p2.x + p2.w, p2.y,
                p1.x + p1.w, p1.y, p1.x - p1.w, p1.y, road);

        // center lane dashes — skipped for sub-pixel far segments, where
        // dozens of translucent draws stack into a white band at the horizon
        if (alt && p1.y - p2.y > 1.5) {
          const lane = mix(pal.lane, pal.skyBot, fog);
          R.quadP(p2.x - p2.w * 0.012, p2.y, p2.x + p2.w * 0.012, p2.y,
                  p1.x + p1.w * 0.015, p1.y, p1.x - p1.w * 0.015, p1.y,
                  [lane[0], lane[1], lane[2], 0.7]);
        }

        // checkered start/finish band on segments 6..7
        const absIdx = (baseIdx + n) % segs.length;
        if (absIdx === 6 || absIdx === 7) {
          const cells = 8;
          for (let i = 0; i < cells; i++) {
            if ((i + absIdx) % 2 === 0) continue;
            const f0 = i / cells * 2 - 1, f1 = (i + 1) / cells * 2 - 1;
            R.quadP(p2.x + p2.w * f0, p2.y, p2.x + p2.w * f1, p2.y,
                    p1.x + p1.w * f1, p1.y, p1.x + p1.w * f0, p1.y,
                    [0.9, 0.9, 0.95, 0.9]);
          }
        }

        // boost pad chevrons and jump ramps (drawn on the road surface);
        // translucent, so skip sub-pixel far segments to avoid stacking
        for (const item of seg.items) {
          if (p1.y - p2.y <= 1.5) break;
          if (item.type === "pad") {
            const pulse = 0.55 + 0.45 * Math.sin(raceT * 6);
            const cx2 = p2.x + p2.w * item.x, cx1 = p1.x + p1.w * item.x;
            R.quadP(cx2 - p2.w * 0.3, p2.y, cx2 + p2.w * 0.3, p2.y,
                    cx1 + p1.w * 0.3, p1.y, cx1 - p1.w * 0.3, p1.y,
                    [pal.glow[0] * pulse, pal.glow[1] * pulse, pal.glow[2] * pulse, 0.75]);
            R.tri(cx1 - p1.w * 0.18, p1.y, cx1 + p1.w * 0.18, p1.y,
                  cx2, p2.y, [1, 1, 1, 0.5 * pulse]);
          } else if (item.type === "ramp") {
            // wedge with a raised lip at the far edge
            const cx2 = p2.x + p2.w * item.x, cx1 = p1.x + p1.w * item.x;
            const lip = p2.w * 0.14;
            R.quadP(cx2 - p2.w * 0.32, p2.y - lip, cx2 + p2.w * 0.32, p2.y - lip,
                    cx1 + p1.w * 0.36, p1.y, cx1 - p1.w * 0.36, p1.y,
                    [1.0, 0.62, 0.15, 0.95]);
            R.quad(cx2 - p2.w * 0.32, p2.y - lip, p2.w * 0.64, lip * 0.35, [1, 1, 1, 0.85]);
            // stripes up the face
            R.quadP(cx2 - p2.w * 0.02, p2.y - lip, cx2 + p2.w * 0.02, p2.y - lip,
                    cx1 + p1.w * 0.03, p1.y, cx1 - p1.w * 0.03, p1.y,
                    [1, 1, 1, 0.55]);
          }
        }

        clipY = Math.min(clipY, yTop);
        drawn = n;
      }
      newHorizon = Math.min(newHorizon, p2.y);
    }
    horizonY = newHorizon;

    // sprites + karts, far to near
    for (let n = drawn; n >= 0; n--) {
      const segIdx = (baseIdx + n) % segs.length;
      const seg = segs[segIdx];
      const p1 = proj[n], p2 = proj[n + 1];
      if (p1.y > h + 60 || p1.y < -50) continue;

      for (const sc of seg.scenery) {
        const sx = p1.x + p1.w * sc.x;
        if (sc.type === "pylon") Sprites.pylon(sx, p1.y, p1.w * 0.1, track.palette.glow);
        else if (sc.type === "arch") Sprites.arch(p1.x, p1.y, p1.w, track.palette.glow);
        else if (sc.type === "startArch") Sprites.startArch(p1.x, p1.y, p1.w);
      }
      for (const item of seg.items) {
        if (!item.alive) continue;
        const sx = p1.x + p1.w * item.x;
        if (item.type === "coin") Sprites.coin(sx, p1.y, p1.w * 0.10, raceT + segIdx);
        else if (item.type === "cone") Sprites.cone(sx, p1.y, p1.w * 0.085);
        else if (item.type === "oil") Sprites.oil(sx, p1.y, p1.w * 0.22);
        else if (item.type === "box" && raceT > (item.deadUntil || 0)) {
          Sprites.itemBox(sx, p1.y, p1.w * 0.13, raceT + segIdx * 0.7);
        }
      }

      // AI karts and missiles on this segment
      for (const c of cars) {
        let rel = zOf(c) - camZ;
        if (rel < -trackLen / 2) rel += trackLen;
        if (rel > trackLen / 2) rel -= trackLen;
        const cn = Math.floor(rel / SEG_LEN + basePct);
        if (cn !== n) continue;
        const pct = (rel / SEG_LEN + basePct) - cn;
        const x = lerp(p1.x, p2.x, pct) + lerp(p1.w, p2.w, pct) * c.x;
        const y = lerp(p1.y, p2.y, pct);
        const kw = lerp(p1.w, p2.w, pct) * 0.28;
        const spin = c.spinT > 0 ? Math.sin((1.3 - c.spinT) * 12) * 2 : 0;
        let lift = 0;
        if (c.airT > 0) {
          lift = Math.sin((1 - c.airT / c.airTotal) * Math.PI) * kw * 0.9;
          R.circle(x, y, kw * 0.4 * (1 - lift / (kw * 2)), [0, 0, 0, 0.3]);
        }
        Sprites.kart(x, y - lift, kw, c.color, { steer: spin, time: raceT });
      }
      for (const m of missiles) {
        let rel = m.z - camZ;
        if (rel < -trackLen / 2) rel += trackLen;
        if (rel > trackLen / 2) rel -= trackLen;
        const mn = Math.floor(rel / SEG_LEN + basePct);
        if (mn !== n) continue;
        const pct = (rel / SEG_LEN + basePct) - mn;
        const x = lerp(p1.x, p2.x, pct) + lerp(p1.w, p2.w, pct) * m.x;
        Sprites.missile(x, lerp(p1.y, p2.y, pct), lerp(p1.w, p2.w, pct) * 0.12, raceT);
      }
    }

    // player kart, fixed near the bottom of the screen
    if (showPlayer && player) {
      // Sized by the same projection as the AI karts (the camera trails
      // the player by 600 units) so your kart and a rival alongside
      // render the same size. Caps are proportional — absolute pixel
      // caps made the kart change size relative to the world when the
      // page was zoomed.
      const kw = Math.min(CAM_DEPTH / 600 * ROAD_W * (w / 2) * 0.28, h * 0.42);
      const px = w / 2 + player.steerVis * w * 0.04;
      const py = h * 0.92 + Math.sin(raceT * 22) * (player.speed / MAX_SPEED) * 1.6
               + (Math.abs(player.x) > 1.04 ? Math.sin(raceT * 50) * 2.5 : 0);
      const spin = player.spinT > 0 ? Math.sin((0.9 - player.spinT) * 14) : 0;
      let lift = 0;
      if (player.airT > 0) {
        lift = Math.sin((1 - player.airT / player.airTotal) * Math.PI) * kw * 1.0;
        R.circle(px, py, kw * 0.45 * (1 - lift / (kw * 2.2)), [0, 0, 0, 0.35]);
      }
      Sprites.kart(px, py - lift, kw, player.color, {
        steer: player.steerVis + spin * 2,
        hop: Math.max(0, player.hopT) * 3,
        drift: player.driftVis,
        charge: player.driftCharge,
        boost: player.boostT > 0,
        time: raceT,
      });
    }

    return curveTotal;
  }

  function render() {
    const pal = track.palette;
    R.clear(pal.skyTop[0], pal.skyTop[1], pal.skyTop[2]);

    let camZ, camX, showPlayer;
    if (state === "menu" || state === "select") {
      camZ = demoZ;
      camX = demoX;
      showPlayer = false;
    } else {
      camZ = (zOf(player) - 600 + trackLen) % trackLen;
      camX = player.x;
      showPlayer = true;
    }

    // sky uses last frame's curve total for parallax — fine at 60fps
    drawSky(pal, lastCurve, camX);
    lastCurve = renderWorld(camZ, camX, showPlayer);
    if (state === "race" || state === "count") drawMinimap();
    R.flush();
  }

  let lastCurve = 0;

  /* ---------------- main loop ---------------- */

  let lastT = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.035, (t - lastT) / 1000 || 0.016);
    lastT = t;
    if (!paused) {
      update(dt);
      render();
    }
  }

  window.addEventListener("resize", function () { R.resize(); });
  window.addEventListener("orientationchange", function () {
    setTimeout(function () { R.resize(); }, 250);
  });
  // iOS ignores user-scalable=no for pinch zoom; block the gesture so
  // zooming can't rescale the canvas mid-race
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener("dblclick", function (e) { e.preventDefault(); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && (state === "race" || state === "count") && !paused) {
      setPaused(true);
    }
  });

  toMenu();
  requestAnimationFrame(frame);
})();
