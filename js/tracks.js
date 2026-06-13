/*
 * Track construction. A track is an array of segments, each SEG_LEN world
 * units long, with a curve value (lateral bend applied while projecting),
 * elevation at both ends, plus per-segment items and scenery sprites.
 *
 * Curve magnitudes: ~2 gentle, ~4 medium, ~6 hairpin.
 */
"use strict";

const Tracks = (function () {
  const SEG_LEN = 200;

  function easeIn(a, b, p) { return a + (b - a) * Math.pow(p, 2); }
  function easeOut(a, b, p) { return a + (b - a) * (1 - Math.pow(1 - p, 2)); }
  function easeInOut(a, b, p) { return a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5); }

  function lastY(segs) {
    return segs.length === 0 ? 0 : segs[segs.length - 1].y2;
  }

  // Append a section: curve eases in over `enter` segments, holds for
  // `hold`, eases out over `leave`. `hill` is total elevation change.
  function addRoad(segs, enter, hold, leave, curve, hill) {
    const startY = lastY(segs);
    const endY = startY + (hill || 0) * SEG_LEN;
    const total = enter + hold + leave;
    for (let i = 0; i < total; i++) {
      let c;
      if (i < enter) c = easeIn(0, curve, i / enter);
      else if (i < enter + hold) c = curve;
      else c = easeInOut(curve, 0, (i - enter - hold) / leave);
      segs.push({
        curve: c,
        y1: easeInOut(startY, endY, i / total),
        y2: easeInOut(startY, endY, (i + 1) / total),
        items: [],
        scenery: [],
      });
    }
  }

  function straight(segs, n, hill) { addRoad(segs, 8, n, 8, 0, hill || 0); }
  function curve(segs, n, c, hill) { addRoad(segs, 14, n, 14, c, hill || 0); }

  // Ease elevation back to zero so the loop seam is smooth.
  function closeLoop(segs, n) {
    addRoad(segs, 8, n, 8, 0, -lastY(segs) / SEG_LEN);
    // force exact zero at the seam
    const last = segs[segs.length - 1];
    last.y2 = 0;
  }

  /* ------------- item / scenery placement ------------- */

  function put(segs, i, type, x) {
    const seg = segs[((i % segs.length) + segs.length) % segs.length];
    seg.items.push({ type: type, x: x, alive: true });
  }

  function coinRow(segs, start, count, x) {
    for (let i = 0; i < count; i++) put(segs, start + i * 4, "coin", x);
  }

  function coinArc(segs, start, count, x0, x1) {
    for (let i = 0; i < count; i++) {
      put(segs, start + i * 4, "coin", x0 + (x1 - x0) * (i / (count - 1)));
    }
  }

  function pad(segs, i, x) { put(segs, i, "pad", x); }
  function cone(segs, i, x) { put(segs, i, "cone", x); }
  function oil(segs, i, x) { put(segs, i, "oil", x); }

  // a rank of three weapon item boxes across the road
  function boxRow(segs, i) {
    put(segs, i, "box", -0.5);
    put(segs, i, "box", 0);
    put(segs, i, "box", 0.5);
  }

  function ramp(segs, i, x) { put(segs, i, "ramp", x); }

  // solid wall chunk: must be steered around (or jumped / star-smashed)
  function barrier(segs, i, x) { put(segs, i, "barrier", x); }

  // moving barrier that oscillates across the road
  function slider(segs, i, x, range, speed) {
    const seg = segs[((i % segs.length) + segs.length) % segs.length];
    seg.items.push({ type: "slider", x: x, range: range, speed: speed || 1,
                     phase: i * 0.7, alive: true });
  }

  // chain of boost pads down the road
  function padChain(segs, i, x, n) {
    for (let k = 0; k < (n || 3); k++) pad(segs, i + k * 3, x);
  }

  function autoScenery(segs) {
    for (let i = 0; i < segs.length; i++) {
      if (i % 9 === 4) {
        segs[i].scenery.push({ type: "pylon", x: -1.35 });
        segs[i].scenery.push({ type: "pylon", x: 1.35 });
      }
      if (i % 120 === 60) segs[i].scenery.push({ type: "arch", x: 0 });
    }
    segs[2].scenery.push({ type: "startArch", x: 0 });
  }

  // Themed scenery: flank the road with `type` sprites instead of pylons.
  // `every` controls density; `off` how far off the road they sit.
  function themedScenery(segs, type, every, off) {
    for (let i = 0; i < segs.length; i++) {
      if (i % every === Math.floor(every / 2)) {
        segs[i].scenery.push({ type: type, x: -off, seed: i });
        segs[i].scenery.push({ type: type, x: off, seed: i * 7 + 3 });
      }
      if (i % 120 === 60) segs[i].scenery.push({ type: "arch", x: 0 });
    }
    segs[2].scenery.push({ type: "startArch", x: 0 });
  }

  /* ------------- the circuits ------------- */

  function sunriseCircuit() {
    const s = [];
    straight(s, 80);
    curve(s, 50, 2);
    straight(s, 50, 1.5);
    curve(s, 60, -2.5, -1.5);
    straight(s, 70);
    curve(s, 40, 3);
    curve(s, 40, -3);
    straight(s, 90, 2);
    curve(s, 70, 2.5, -2);
    straight(s, 60);
    curve(s, 50, -2);
    closeLoop(s, 70);

    coinRow(s, 95, 5, 0);
    coinArc(s, 165, 6, -0.4, 0.5);
    coinRow(s, 330, 5, -0.3);
    coinArc(s, 470, 6, 0.5, -0.4);
    coinRow(s, 640, 5, 0.3);
    pad(s, 210, 0);
    pad(s, 530, -0.3);
    pad(s, 700, 0.2);
    cone(s, 290, 0.4);
    cone(s, 292, -0.5);
    cone(s, 600, 0);
    oil(s, 420, 0.2);
    boxRow(s, 60);
    boxRow(s, 450);
    ramp(s, 130, 0);
    ramp(s, 560, -0.25);
    padChain(s, 700, 0.2, 3);
    barrier(s, 380, -0.4);
    autoScenery(s);
    return {
      name: "SUNRISE CIRCUIT",
      laps: 3,
      segs: s,
      palette: {
        skyTop: [0.03, 0.02, 0.10], skyBot: [0.55, 0.12, 0.35],
        sun: [1.0, 0.55, 0.25], sunLo: [1.0, 0.2, 0.45],
        groundA: [0.05, 0.03, 0.12], groundB: [0.07, 0.04, 0.16],
        roadA: [0.13, 0.13, 0.20], roadB: [0.11, 0.11, 0.17],
        rumbleA: [0.95, 0.25, 0.55], rumbleB: [0.15, 0.9, 0.95],
        lane: [0.9, 0.9, 1.0],
        glow: [0.15, 0.9, 0.95],
      },
    };
  }

  function neonSpiral() {
    const s = [];
    straight(s, 60);
    curve(s, 60, 3, 2);
    curve(s, 50, 4);
    straight(s, 40, -2);
    curve(s, 60, -4);
    curve(s, 40, -2.5, 2.5);
    straight(s, 60);
    curve(s, 80, 4.5, -2.5);
    straight(s, 30);
    curve(s, 50, -3.5, 1.5);
    curve(s, 50, 3.5, -1.5);
    straight(s, 50);
    closeLoop(s, 60);

    coinArc(s, 80, 7, -0.5, 0.5);
    coinRow(s, 240, 5, -0.4);
    coinArc(s, 420, 7, 0.5, -0.5);
    coinRow(s, 580, 6, 0.4);
    coinRow(s, 720, 5, 0);
    pad(s, 150, 0.4);
    pad(s, 360, 0);
    pad(s, 660, -0.4);
    cone(s, 200, -0.2);
    cone(s, 202, 0.55);
    cone(s, 470, 0.1);
    cone(s, 472, -0.5);
    cone(s, 620, 0.35);
    oil(s, 310, -0.25);
    oil(s, 540, 0.3);
    boxRow(s, 55);
    boxRow(s, 410);
    boxRow(s, 760);
    ramp(s, 100, 0.3);
    ramp(s, 500, -0.2);
    padChain(s, 360, 0, 3);
    barrier(s, 270, 0.45);
    barrier(s, 690, -0.4);
    autoScenery(s);
    return {
      name: "NEON SPIRAL",
      laps: 3,
      segs: s,
      palette: {
        skyFx: "planet",
        skyTop: [0.01, 0.03, 0.10], skyBot: [0.10, 0.35, 0.55],
        sun: [0.3, 0.95, 1.0], sunLo: [0.5, 0.3, 1.0],
        groundA: [0.02, 0.05, 0.10], groundB: [0.03, 0.07, 0.13],
        roadA: [0.10, 0.13, 0.20], roadB: [0.08, 0.11, 0.17],
        rumbleA: [0.2, 0.95, 1.0], rumbleB: [0.6, 0.3, 1.0],
        lane: [0.85, 0.95, 1.0],
        glow: [0.5, 0.4, 1.0],
      },
    };
  }

  function midnightGorge() {
    const s = [];
    straight(s, 50);
    curve(s, 40, 4, 3);
    curve(s, 40, -5);
    curve(s, 40, 5, -3);
    straight(s, 50, 2);
    curve(s, 70, -5.5, -2);
    straight(s, 30);
    curve(s, 40, 3.5, 3);
    curve(s, 40, -3.5);
    curve(s, 40, 3.5, -3);
    straight(s, 60, -1);
    curve(s, 80, 6, 1);
    straight(s, 40);
    curve(s, 50, -4.5);
    closeLoop(s, 50);

    coinArc(s, 70, 6, -0.5, 0.5);
    coinArc(s, 150, 6, 0.5, -0.5);
    coinRow(s, 320, 5, 0);
    coinArc(s, 480, 7, -0.5, 0.5);
    coinRow(s, 650, 5, -0.35);
    pad(s, 120, -0.3);
    pad(s, 400, 0.3);
    pad(s, 720, 0);
    cone(s, 180, 0.3);
    cone(s, 182, -0.4);
    cone(s, 184, 0.6);
    cone(s, 440, -0.1);
    cone(s, 442, 0.5);
    cone(s, 560, -0.45);
    cone(s, 562, 0.2);
    oil(s, 250, 0.25);
    oil(s, 370, -0.3);
    oil(s, 610, 0);
    boxRow(s, 45);
    boxRow(s, 350);
    boxRow(s, 690);
    ramp(s, 90, -0.2);
    ramp(s, 410, 0.25);
    ramp(s, 700, 0);
    padChain(s, 120, -0.3, 3);
    slider(s, 290, 0, 0.55, 1.3);
    slider(s, 640, 0, 0.5, 1.6);
    autoScenery(s);
    return {
      name: "MIDNIGHT GORGE",
      laps: 3,
      segs: s,
      palette: {
        skyFx: "storm",
        skyTop: [0.01, 0.01, 0.05], skyBot: [0.20, 0.05, 0.30],
        sun: [0.9, 0.3, 1.0], sunLo: [1.0, 0.2, 0.5],
        groundA: [0.04, 0.02, 0.08], groundB: [0.05, 0.03, 0.11],
        roadA: [0.11, 0.10, 0.16], roadB: [0.09, 0.08, 0.13],
        rumbleA: [1.0, 0.3, 0.8], rumbleB: [1.0, 0.8, 0.2],
        lane: [1.0, 0.9, 0.95],
        glow: [1.0, 0.3, 0.8],
      },
    };
  }

  function auroraPass() {
    const s = [];
    straight(s, 60);
    curve(s, 50, 2.5, 3);
    curve(s, 50, -2.5, 3);
    curve(s, 50, 2.5, -2);
    straight(s, 40, -4);
    curve(s, 70, -3.5);
    straight(s, 60, 3);
    curve(s, 50, 3, -3);
    curve(s, 50, -3);
    straight(s, 80, 2);
    curve(s, 60, 4, -2);
    closeLoop(s, 60);

    coinArc(s, 75, 7, -0.5, 0.5);
    coinArc(s, 175, 7, 0.5, -0.5);
    coinRow(s, 340, 6, 0);
    coinArc(s, 520, 6, -0.4, 0.4);
    coinRow(s, 680, 5, 0.35);
    pad(s, 140, 0);
    pad(s, 430, -0.35);
    pad(s, 640, 0.3);
    cone(s, 240, 0.45);
    cone(s, 242, -0.3);
    cone(s, 590, 0.1);
    oil(s, 380, 0.25);
    oil(s, 500, -0.2);
    boxRow(s, 50);
    boxRow(s, 390);
    boxRow(s, 720);
    ramp(s, 160, 0);
    ramp(s, 450, 0.3);
    ramp(s, 690, -0.3);
    padChain(s, 140, 0, 3);
    slider(s, 300, 0, 0.5, 0.8);
    autoScenery(s);
    return {
      name: "AURORA PASS",
      laps: 3,
      segs: s,
      palette: {
        skyFx: "aurora",
        skyTop: [0.01, 0.04, 0.07], skyBot: [0.05, 0.40, 0.32],
        sun: [0.55, 1.0, 0.7], sunLo: [0.15, 0.75, 0.85],
        groundA: [0.02, 0.07, 0.06], groundB: [0.03, 0.09, 0.08],
        roadA: [0.09, 0.13, 0.14], roadB: [0.07, 0.11, 0.12],
        rumbleA: [0.25, 1.0, 0.55], rumbleB: [0.9, 0.95, 1.0],
        lane: [0.85, 1.0, 0.9],
        glow: [0.3, 1.0, 0.6],
      },
    };
  }

  function crimsonCanyon() {
    const s = [];
    straight(s, 70);
    curve(s, 90, 3, -3);
    straight(s, 40, 2);
    curve(s, 40, -5.5, 2);
    curve(s, 30, 5.5);
    straight(s, 60, -2);
    curve(s, 80, -3);
    straight(s, 50, 4);
    curve(s, 50, 4.5, -4);
    straight(s, 40);
    curve(s, 60, -4, 1);
    curve(s, 40, 2.5, -1);
    closeLoop(s, 60);

    coinRow(s, 90, 6, -0.3);
    coinArc(s, 230, 7, 0.5, -0.5);
    coinRow(s, 400, 5, 0.4);
    coinArc(s, 560, 6, -0.5, 0.4);
    coinRow(s, 700, 6, 0);
    pad(s, 160, 0.3);
    pad(s, 470, 0);
    pad(s, 680, -0.3);
    cone(s, 210, -0.45);
    cone(s, 212, 0.25);
    cone(s, 520, 0.5);
    cone(s, 522, -0.15);
    oil(s, 300, 0);
    oil(s, 620, 0.3);
    boxRow(s, 55);
    boxRow(s, 370);
    boxRow(s, 730);
    ramp(s, 110, 0.2);
    ramp(s, 640, -0.25);
    padChain(s, 470, 0, 3);
    barrier(s, 250, 0.4);
    barrier(s, 590, -0.45);
    autoScenery(s);
    return {
      name: "CRIMSON CANYON",
      laps: 3,
      segs: s,
      palette: {
        skyTop: [0.06, 0.01, 0.03], skyBot: [0.65, 0.22, 0.07],
        sun: [1.0, 0.85, 0.35], sunLo: [1.0, 0.4, 0.1],
        groundA: [0.09, 0.03, 0.03], groundB: [0.12, 0.04, 0.04],
        roadA: [0.14, 0.10, 0.11], roadB: [0.12, 0.08, 0.09],
        rumbleA: [1.0, 0.5, 0.15], rumbleB: [0.95, 0.9, 0.85],
        lane: [1.0, 0.92, 0.8],
        glow: [1.0, 0.5, 0.2],
      },
    };
  }

  function starlightBay() {
    const s = [];
    straight(s, 100);
    curve(s, 40, -3, 1.5);
    curve(s, 40, 3, -1.5);
    straight(s, 80);
    curve(s, 70, 5, 2);
    straight(s, 40, -2);
    curve(s, 40, -2.5);
    curve(s, 40, 2.5);
    straight(s, 70, 3);
    curve(s, 80, -4.5, -3);
    straight(s, 50);
    curve(s, 50, 3.5);
    closeLoop(s, 70);

    coinRow(s, 110, 7, 0);
    coinArc(s, 250, 6, -0.45, 0.45);
    coinRow(s, 420, 6, -0.35);
    coinArc(s, 570, 7, 0.5, -0.5);
    coinRow(s, 730, 5, 0.3);
    pad(s, 60, -0.3);
    pad(s, 330, 0.35);
    pad(s, 700, 0);
    cone(s, 190, 0.2);
    cone(s, 192, -0.5);
    cone(s, 480, 0.45);
    cone(s, 482, -0.2);
    oil(s, 290, -0.25);
    oil(s, 640, 0.2);
    boxRow(s, 70);
    boxRow(s, 400);
    boxRow(s, 760);
    ramp(s, 130, -0.25);
    ramp(s, 440, 0.25);
    ramp(s, 770, 0);
    padChain(s, 60, -0.3, 4);
    slider(s, 360, 0, 0.55, 1.0);
    barrier(s, 670, 0.45);
    autoScenery(s);
    return {
      name: "STARLIGHT BAY",
      laps: 3,
      segs: s,
      palette: {
        skyFx: "moon",
        skyTop: [0.0, 0.01, 0.07], skyBot: [0.14, 0.18, 0.55],
        sun: [0.75, 0.85, 1.0], sunLo: [0.85, 0.4, 1.0],
        groundA: [0.02, 0.03, 0.09], groundB: [0.03, 0.04, 0.12],
        roadA: [0.10, 0.11, 0.18], roadB: [0.08, 0.09, 0.15],
        rumbleA: [0.45, 0.6, 1.0], rumbleB: [1.0, 0.45, 0.85],
        lane: [0.9, 0.92, 1.0],
        glow: [0.5, 0.6, 1.0],
      },
    };
  }

  /*
   * PALM ROYALE — tropical beach resort at sunset. Long, flowing
   * sweepers you can take flat out; palms line the whole lap.
   * The easiest circuit: wide rhythm, few hazards.
   */
  function palmRoyale() {
    const s = [];
    straight(s, 90);
    curve(s, 70, 2);
    straight(s, 50, -1);
    curve(s, 80, -2.5, 1);
    straight(s, 60, 1.5);
    curve(s, 50, 3, -1.5);
    straight(s, 100);            // beach straight
    curve(s, 60, -3);
    curve(s, 60, 2, 1);
    straight(s, 40, -1);
    closeLoop(s, 70);

    coinRow(s, 100, 6, 0);
    coinArc(s, 200, 7, -0.5, 0.5);
    coinRow(s, 380, 6, -0.35);
    coinArc(s, 520, 7, 0.45, -0.45);
    coinRow(s, 700, 6, 0.3);
    pad(s, 150, 0.3);
    padChain(s, 450, 0, 4);      // pad chain down the beach straight
    pad(s, 760, -0.3);
    cone(s, 280, 0.4);
    cone(s, 282, -0.45);
    cone(s, 660, 0.1);
    oil(s, 580, -0.2);
    boxRow(s, 60);
    boxRow(s, 420);
    boxRow(s, 740);
    ramp(s, 250, 0);
    ramp(s, 490, 0.25);
    themedScenery(s, "palm", 7, 1.5);
    return {
      name: "PALM ROYALE",
      laps: 3,
      roadScale: 1.05,
      segs: s,
      palette: {
        skyTop: [0.02, 0.04, 0.10], skyBot: [0.80, 0.42, 0.16],
        sun: [1.0, 0.78, 0.30], sunLo: [1.0, 0.35, 0.30],
        groundA: [0.07, 0.05, 0.05], groundB: [0.09, 0.07, 0.06],
        roadA: [0.12, 0.12, 0.18], roadB: [0.10, 0.10, 0.15],
        rumbleA: [0.10, 0.90, 0.78], rumbleB: [1.0, 0.65, 0.25],
        lane: [1.0, 0.95, 0.85],
        glow: [0.15, 0.95, 0.80],
      },
    };
  }

  /*
   * SOLAR FLARE — desert speedway under a giant golden sun. Massive
   * straights and flat-out sweepers; the fastest average speed in the
   * game. Back straight has a triple ramp row.
   */
  function solarFlare() {
    const s = [];
    straight(s, 120);            // launch straight
    curve(s, 90, 2.5, -2);
    straight(s, 80, 1);
    curve(s, 60, -3);
    straight(s, 100, -1);        // back straight — ramp row
    curve(s, 70, 3.5, 2);
    straight(s, 50);
    curve(s, 80, -2, -2);
    closeLoop(s, 80);

    coinRow(s, 60, 8, 0);
    coinArc(s, 230, 7, -0.5, 0.5);
    coinRow(s, 420, 7, 0.35);
    coinArc(s, 560, 6, 0.45, -0.45);
    coinRow(s, 720, 6, -0.3);
    padChain(s, 40, -0.35, 4);
    padChain(s, 400, 0.35, 4);
    pad(s, 650, 0);
    cone(s, 330, -0.4);
    cone(s, 332, 0.3);
    cone(s, 690, -0.15);
    oil(s, 510, 0.25);
    boxRow(s, 90);
    boxRow(s, 470);
    boxRow(s, 750);
    ramp(s, 430, -0.3);          // triple ramps down the back straight
    ramp(s, 436, 0);
    ramp(s, 442, 0.3);
    ramp(s, 150, 0);
    slider(s, 560, 0, 0.6, 1.1); // sweeping gate on the run home
    themedScenery(s, "cactus", 8, 1.55);
    return {
      name: "SOLAR FLARE",
      laps: 3,
      roadScale: 1.18,
      lanes: 3,
      segs: s,
      palette: {
        skyFx: "binary",
        skyTop: [0.07, 0.02, 0.01], skyBot: [0.82, 0.52, 0.10],
        sun: [1.0, 0.90, 0.45], sunLo: [1.0, 0.55, 0.15],
        groundA: [0.10, 0.05, 0.02], groundB: [0.13, 0.07, 0.03],
        roadA: [0.15, 0.12, 0.10], roadB: [0.13, 0.10, 0.08],
        rumbleA: [1.0, 0.82, 0.20], rumbleB: [0.30, 0.10, 0.05],
        lane: [1.0, 0.95, 0.80],
        glow: [1.0, 0.80, 0.25],
      },
    };
  }

  /*
   * CHROME CITY — night street circuit between glowing towers.
   * Tight and technical: chicanes, a hairpin, 90-degree blocks.
   * Walls of skyscrapers with lit windows line the route.
   */
  function chromeCity() {
    const s = [];
    straight(s, 60);
    curve(s, 30, 4);
    straight(s, 20);
    curve(s, 30, -4);
    straight(s, 30, 1);
    curve(s, 25, 5);             // chicane in
    curve(s, 25, -5);            // chicane out
    straight(s, 50, -1);
    curve(s, 40, 4.5, 1);
    straight(s, 30);
    curve(s, 30, -5.5);          // hairpin
    straight(s, 40, -1);
    curve(s, 30, 3.5);
    curve(s, 30, -3.5);
    straight(s, 60, 1);
    curve(s, 50, 5, -1);
    closeLoop(s, 50);

    coinRow(s, 70, 5, 0);
    coinArc(s, 170, 6, -0.45, 0.45);
    coinRow(s, 300, 5, -0.3);
    coinArc(s, 430, 6, 0.45, -0.45);
    coinRow(s, 580, 5, 0.3);
    pad(s, 130, 0);
    pad(s, 380, -0.3);
    pad(s, 620, 0.3);
    cone(s, 110, 0.35);          // chicane clutter
    cone(s, 112, -0.45);
    cone(s, 240, 0.2);
    cone(s, 242, -0.35);
    cone(s, 460, 0.45);
    cone(s, 462, -0.1);
    oil(s, 210, -0.25);          // corner-exit oil
    oil(s, 350, 0.3);
    oil(s, 540, -0.2);
    boxRow(s, 50);
    boxRow(s, 330);
    boxRow(s, 600);
    ramp(s, 280, 0);
    barrier(s, 90, -0.45);       // construction zones squeeze the streets
    barrier(s, 320, 0.45);
    barrier(s, 500, -0.4);
    themedScenery(s, "building", 5, 1.85);
    return {
      name: "CHROME CITY",
      laps: 3,
      roadScale: 0.85,
      segs: s,
      palette: {
        skyFx: "skyline",
        skyTop: [0.01, 0.01, 0.04], skyBot: [0.12, 0.13, 0.22],
        sun: [0.92, 0.94, 1.0], sunLo: [0.50, 0.55, 0.70],
        groundA: [0.03, 0.03, 0.05], groundB: [0.04, 0.04, 0.07],
        roadA: [0.12, 0.12, 0.15], roadB: [0.10, 0.10, 0.13],
        rumbleA: [1.0, 0.88, 0.25], rumbleB: [0.20, 0.22, 0.30],
        lane: [1.0, 0.95, 0.70],
        glow: [1.0, 0.88, 0.30],
      },
    };
  }

  /*
   * CRYSTAL CAVERN — a violet underground of glowing shards. The
   * biggest elevation swings in the game: two long climbs with blind
   * crests dropping into descending spirals.
   */
  function crystalCavern() {
    const s = [];
    straight(s, 50);
    curve(s, 50, 3, 4);          // big climb
    curve(s, 40, -4, 2);
    straight(s, 30, -3);         // blind crest drop
    curve(s, 60, 5, -3);         // descending spiral
    straight(s, 40);
    curve(s, 40, -3.5, 3);
    curve(s, 40, 3.5, -2);
    straight(s, 60, 4);          // second climb
    curve(s, 70, -5, -4);        // long downhill hairpin
    straight(s, 30);
    curve(s, 40, 2.5, 1);
    closeLoop(s, 60);

    coinArc(s, 70, 6, -0.5, 0.5);
    coinRow(s, 190, 5, 0.3);
    coinArc(s, 330, 7, 0.5, -0.5);
    coinRow(s, 480, 5, -0.35);
    coinArc(s, 600, 6, -0.4, 0.4);
    pad(s, 140, -0.3);
    pad(s, 410, 0.3);
    pad(s, 640, 0);
    cone(s, 220, 0.4);
    cone(s, 222, -0.3);
    cone(s, 370, -0.45);
    cone(s, 372, 0.15);
    cone(s, 560, 0.3);
    oil(s, 260, 0.2);
    oil(s, 450, -0.25);
    oil(s, 620, 0.1);
    boxRow(s, 55);
    boxRow(s, 350);
    boxRow(s, 660);
    ramp(s, 120, 0.25);          // ramp at the crest = big air
    ramp(s, 430, -0.2);
    padChain(s, 640, 0, 3);
    barrier(s, 200, 0.4);        // fallen rock blocks
    barrier(s, 520, -0.45);
    slider(s, 690, 0, 0.5, 1.2);
    themedScenery(s, "crystal", 6, 1.45);
    return {
      name: "CRYSTAL CAVERN",
      laps: 3,
      roadScale: 0.9,
      segs: s,
      palette: {
        skyFx: "cave",
        skyTop: [0.02, 0.01, 0.06], skyBot: [0.22, 0.12, 0.45],
        sun: [0.75, 0.60, 1.0], sunLo: [0.40, 0.70, 1.0],
        groundA: [0.04, 0.03, 0.09], groundB: [0.05, 0.04, 0.12],
        roadA: [0.10, 0.09, 0.17], roadB: [0.08, 0.07, 0.14],
        rumbleA: [0.62, 0.40, 1.0], rumbleB: [0.35, 0.85, 1.0],
        lane: [0.92, 0.88, 1.0],
        glow: [0.62, 0.45, 1.0],
      },
    };
  }

  /*
   * INFERNO RIDGE — volcanic caldera at dusk. Fast and moderately
   * technical: long drags broken by sharp descents into the crater,
   * ramps placed over the hottest fissures. Molten "lava" sky, jagged
   * lavarock scenery, amber-on-char palette.
   */
  function infernoRidge() {
    const s = [];
    straight(s, 70);
    curve(s, 60, 3, 2);
    curve(s, 50, -3.5, -1);
    straight(s, 80, 1);
    curve(s, 70, 4, 2);
    curve(s, 60, -4, -2);
    straight(s, 40, -1);
    curve(s, 50, 3.5, 1.5);
    curve(s, 45, -3.5, -1.5);
    straight(s, 90, 2);
    curve(s, 80, 2.5, -2);
    curve(s, 70, -2.5);
    closeLoop(s, 80);

    coinRow(s, 75, 7, 0);
    coinArc(s, 190, 6, -0.45, 0.45);
    coinRow(s, 350, 6, 0.3);
    coinArc(s, 520, 7, 0.5, -0.5);
    coinRow(s, 680, 5, -0.3);
    pad(s, 140, 0);
    pad(s, 380, -0.3);
    pad(s, 650, 0.25);
    padChain(s, 650, 0.25, 3);
    cone(s, 210, 0.4);
    cone(s, 212, -0.45);
    cone(s, 470, 0.15);
    oil(s, 310, 0.2);
    oil(s, 580, -0.25);
    boxRow(s, 60);
    boxRow(s, 380);
    boxRow(s, 720);
    ramp(s, 130, -0.1);
    ramp(s, 420, 0.2);
    ramp(s, 710, -0.2);
    barrier(s, 240, -0.4);
    barrier(s, 550, 0.45);
    slider(s, 300, 0, 0.5, 1.2);
    themedScenery(s, "lavarock", 8, 1.6);
    return {
      name: "INFERNO RIDGE",
      laps: 3,
      segs: s,
      palette: {
        skyFx: "lava",
        skyTop: [0.15, 0.06, 0.02], skyBot: [0.70, 0.32, 0.08],
        sun: [1.0, 0.55, 0.20], sunLo: [1.0, 0.80, 0.40],
        groundA: [0.08, 0.04, 0.03], groundB: [0.10, 0.06, 0.04],
        roadA: [0.14, 0.10, 0.09], roadB: [0.12, 0.08, 0.07],
        rumbleA: [1.0, 0.70, 0.15], rumbleB: [1.0, 0.40, 0.10],
        lane: [1.0, 0.92, 0.78],
        glow: [1.0, 0.55, 0.18],
      },
    };
  }

  /*
   * ABYSSAL TRENCH — deep-sea canyon lit only by bioluminescence.
   * Tight and twisting, narrower road, slower flow; coral walls and a
   * huge shadow drifting across the "abyss" sky. Cyan-on-black palette.
   */
  function abyssalTrench() {
    const s = [];
    straight(s, 60);
    curve(s, 50, 3.5, -1);
    curve(s, 50, -4.5, -2);
    straight(s, 40, -2);
    curve(s, 60, 2.5, 1);
    curve(s, 55, -3, 0);
    straight(s, 50, 1);
    curve(s, 70, 4, 2);
    curve(s, 65, -3.5, -1.5);
    straight(s, 45, -1);
    curve(s, 60, 3, 1);
    curve(s, 55, -2.5, -0.5);
    straight(s, 70, 1);
    closeLoop(s, 70);

    coinRow(s, 65, 5, 0);
    coinArc(s, 160, 6, -0.4, 0.4);
    coinRow(s, 300, 5, 0.25);
    coinArc(s, 460, 6, 0.5, -0.5);
    coinRow(s, 620, 5, -0.3);
    pad(s, 130, 0);
    pad(s, 400, 0.2);
    pad(s, 660, -0.25);
    cone(s, 190, 0.35);
    cone(s, 192, -0.4);
    cone(s, 500, 0.4);
    cone(s, 502, -0.2);
    oil(s, 240, -0.2);
    oil(s, 360, 0.25);
    oil(s, 580, 0);
    boxRow(s, 55);
    boxRow(s, 340);
    boxRow(s, 680);
    ramp(s, 110, -0.15);
    ramp(s, 620, 0.2);
    barrier(s, 220, 0.45);
    barrier(s, 420, -0.4);
    slider(s, 280, 0, 0.4, 1.0);
    slider(s, 500, 0, 0.35, 0.8);
    themedScenery(s, "coral", 6, 1.4);
    return {
      name: "ABYSSAL TRENCH",
      laps: 3,
      roadScale: 0.9,
      segs: s,
      palette: {
        skyFx: "abyss",
        skyTop: [0.01, 0.03, 0.08], skyBot: [0.04, 0.10, 0.18],
        sun: [0.35, 0.65, 1.0], sunLo: [0.55, 0.80, 1.0],
        groundA: [0.02, 0.04, 0.10], groundB: [0.03, 0.05, 0.12],
        roadA: [0.06, 0.12, 0.20], roadB: [0.05, 0.10, 0.18],
        rumbleA: [0.40, 0.75, 1.0], rumbleB: [0.30, 0.60, 0.95],
        lane: [0.65, 0.90, 1.0],
        glow: [0.45, 0.80, 1.0],
      },
    };
  }

  // Order is the GP running order: difficulty ramps up.
  const list = [sunriseCircuit, palmRoyale, neonSpiral, auroraPass, solarFlare,
                starlightBay, infernoRidge, crimsonCanyon, abyssalTrench,
                chromeCity, crystalCavern, midnightGorge];
  const meta = [
    { name: "SUNRISE CIRCUIT", color: "#ff4d8c" },
    { name: "PALM ROYALE", color: "#2ee6c0" },
    { name: "NEON SPIRAL", color: "#8c4dff" },
    { name: "AURORA PASS", color: "#4dff99" },
    { name: "SOLAR FLARE", color: "#ffd24d" },
    { name: "STARLIGHT BAY", color: "#7a99ff" },
    { name: "INFERNO RIDGE", color: "#ff5a1e" },
    { name: "CRIMSON CANYON", color: "#ff8033" },
    { name: "ABYSSAL TRENCH", color: "#33c9ff" },
    { name: "CHROME CITY", color: "#f2f24d" },
    { name: "CRYSTAL CAVERN", color: "#b366ff" },
    { name: "MIDNIGHT GORGE", color: "#ff4dcc" },
  ];

  return {
    SEG_LEN,
    list,
    meta,
  };
})();
