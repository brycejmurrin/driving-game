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

  /* ------------- the three circuits ------------- */

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
    autoScenery(s);
    return {
      name: "NEON SPIRAL",
      laps: 3,
      segs: s,
      palette: {
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
    autoScenery(s);
    return {
      name: "MIDNIGHT GORGE",
      laps: 3,
      segs: s,
      palette: {
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

  return {
    SEG_LEN,
    list: [sunriseCircuit, neonSpiral, midnightGorge],
  };
})();
