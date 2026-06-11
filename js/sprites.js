/*
 * Vector sprites for the road world. Everything is drawn from solid
 * triangles at a given screen position and scale. `w` is the desired
 * on-screen width of the sprite; positions are the sprite's bottom-center
 * (sitting on the road).
 */
"use strict";

const Sprites = (function () {
  const R = Renderer;

  function shade(c, f, a) {
    return [c[0] * f, c[1] * f, c[2] * f, a === undefined ? 1 : a];
  }

  /*
   * Kart seen from behind. steer tilts the body, hop lifts it,
   * boost draws exhaust flames, drift kicks the rear out.
   * Proportions: wide low bumper between two fat tires, narrow cockpit,
   * small helmet, raised spoiler — reads as a kart at any scale.
   */
  function kart(x, y, w, color, opts) {
    const o = opts || {};
    const steer = o.steer || 0;
    const hop = (o.hop || 0) * w * 0.25;
    const drift = o.drift || 0;
    const h = w * 0.52;
    y -= hop;

    const lean = steer * 0.14;
    // drifting: the rear swings OUT, opposite the turn (tilt right ->
    // nose right, tail kicks left), top leans into the turn. Kept small —
    // the parts translate independently, so big offsets read as the kart
    // falling apart rather than yawing.
    const kick = -drift;
    const rear = kick * w * 0.08;      // applied to tires / bumper / glow
    const nose = -kick * w * 0.04;     // applied to cockpit / spoiler / helmet
    const by = y;            // bottom (wheel contact)
    const skew = lean * w * 0.35;
    const topShift = nose - rear * 0.5;

    // underglow
    R.circle(x + rear * 0.6, by - h * 0.04, w * 0.5, shade(color, 1.2, 0.13), 14);

    // rear tires
    const wy = by - h * 0.22;
    const ww = w * 0.17, wh = h * 0.44;
    R.rotQuad(x - w * 0.42 + skew * 0.25 + rear, wy, ww, wh, lean * 0.4 + kick * 0.12, [0.04, 0.04, 0.07, 1]);
    R.rotQuad(x + w * 0.42 + skew * 0.25 + rear, wy, ww, wh, lean * 0.4 + kick * 0.12, [0.04, 0.04, 0.07, 1]);
    R.circle(x - w * 0.42 + skew * 0.25 + rear, wy, ww * 0.2, shade(color, 1.4), 8);
    R.circle(x + w * 0.42 + skew * 0.25 + rear, wy, ww * 0.2, shade(color, 1.4), 8);

    // bumper: wide low block between the tires
    const bx = x + skew * 0.4 + rear * 0.8;
    R.quadP(
      bx - w * 0.34, by - h * 0.40,
      bx + w * 0.34, by - h * 0.40,
      bx + w * 0.37, by - h * 0.06,
      bx - w * 0.37, by - h * 0.06,
      shade(color, 0.95)
    );
    // tail light strip
    R.quad(bx - w * 0.28, by - h * 0.34, w * 0.56, h * 0.08, shade(color, 1.6));

    // cockpit: narrower trapezoid above the bumper
    R.quadP(
      bx - w * 0.20 - skew * 0.3 + topShift, by - h * 0.62,
      bx + w * 0.20 - skew * 0.3 + topShift, by - h * 0.62,
      bx + w * 0.27, by - h * 0.38,
      bx - w * 0.27, by - h * 0.38,
      shade(color, 0.7)
    );

    // spoiler: thin raised wing
    const sy = by - h * 0.78;
    R.quad(bx - w * 0.06 - skew * 0.4 + topShift, sy, w * 0.04, h * 0.16, shade(color, 0.55));
    R.quad(bx + w * 0.02 - skew * 0.4 + topShift, sy, w * 0.04, h * 0.16, shade(color, 0.55));
    R.quadP(
      bx - w * 0.33 - skew * 0.5 + topShift, sy - h * 0.10,
      bx + w * 0.33 - skew * 0.5 + topShift, sy - h * 0.10,
      bx + w * 0.29 - skew * 0.45 + topShift, sy,
      bx - w * 0.29 - skew * 0.45 + topShift, sy,
      shade(color, 1.1)
    );

    // driver helmet
    R.circle(bx - skew * 0.35 + topShift, by - h * 0.66, w * 0.095, [0.95, 0.95, 1.0, 1], 10);
    R.circle(bx - skew * 0.35 + topShift, by - h * 0.66, w * 0.095, shade(color, 0.5, 0.4), 10);

    // exhaust flames while boosting
    if (o.boost) {
      const t = o.time || 0;
      const fl = (Math.sin(t * 40) * 0.5 + 0.5) * w * 0.3 + w * 0.2;
      R.tri(x - w * 0.18, by - h * 0.05, x - w * 0.05, by - h * 0.05,
            x - w * 0.115, by + fl, [1.0, 0.7, 0.2, 0.9]);
      R.tri(x + w * 0.05, by - h * 0.05, x + w * 0.18, by - h * 0.05,
            x + w * 0.115, by + fl, [0.3, 0.8, 1.0, 0.9]);
    }
    // drift sparks
    if (Math.abs(drift) > 0.01 && o.charge) {
      const sc = o.charge > 1 ? [0.3, 0.9, 1.0, 0.9] : [1.0, 0.8, 0.2, 0.9];
      const t = o.time || 0;
      for (let i = 0; i < 3; i++) {
        const a = t * 30 + i * 2.1;
        const sx = x - Math.sign(drift) * w * 0.45 + Math.sin(a) * w * 0.1;
        R.circle(sx, by + Math.cos(a * 1.3) * w * 0.06, w * 0.045, sc, 6);
      }
    }
  }

  function cone(x, y, w) {
    const h = w * 1.25;
    R.tri(x - w / 2, y, x + w / 2, y, x, y - h, [1.0, 0.45, 0.1, 1]);
    R.quadP(x - w * 0.26, y - h * 0.42, x + w * 0.26, y - h * 0.42,
            x + w * 0.32, y - h * 0.26, x - w * 0.32, y - h * 0.26,
            [1, 1, 1, 0.95]);
    R.quad(x - w * 0.6, y - w * 0.07, w * 1.2, w * 0.09, [0.9, 0.35, 0.05, 1]);
  }

  function oil(x, y, w) {
    R.circle(x, y, w * 0.5, [0.03, 0.02, 0.06, 0.92], 14);
    R.arc(x, y, w * 0.28, w * 0.4, 2.6, 4.6, [0.45, 0.2, 0.8, 0.5], 8);
    // squash into the road plane
  }

  function coin(x, y, w, t) {
    const squash = Math.abs(Math.sin(t * 4)) * 0.75 + 0.25;
    const r = w * 0.5;
    R.circle(x, y - r * 1.3, r * squash * 1.05, [1.0, 0.85, 0.2, 0.35], 12);
    R.circle(x, y - r * 1.3, r * squash, [1.0, 0.78, 0.1, 1], 12);
    R.circle(x, y - r * 1.3, r * squash * 0.55, [1.0, 0.95, 0.5, 1], 10);
  }

  function pylon(x, y, w, glowColor) {
    const h = w * 5;
    R.quad(x - w * 0.12, y - h, w * 0.24, h, [0.1, 0.1, 0.16, 1]);
    R.quad(x - w * 0.07, y - h, w * 0.14, h, [glowColor[0], glowColor[1], glowColor[2], 0.8]);
    R.circle(x, y - h, w * 0.4, [glowColor[0], glowColor[1], glowColor[2], 0.5], 10);
    R.circle(x, y - h, w * 0.2, [1, 1, 1, 0.9], 8);
  }

  // Arch spanning the road; w = full road screen width at this segment.
  function arch(x, y, w, glowColor) {
    const h = w * 0.30;
    const pw = w * 0.035;
    R.quad(x - w * 0.55, y - h, pw, h, [0.1, 0.1, 0.16, 1]);
    R.quad(x + w * 0.55 - pw, y - h, pw, h, [0.1, 0.1, 0.16, 1]);
    R.quad(x - w * 0.55, y - h - pw * 1.6, w * 1.1, pw * 1.2,
           [glowColor[0], glowColor[1], glowColor[2], 0.9]);
    R.quad(x - w * 0.55, y - h - pw * 2.4, w * 1.1, pw * 0.5, [1, 1, 1, 0.5]);
  }

  // Floating weapon item box: spinning rainbow-shifting cube with a "?".
  function itemBox(x, y, w, t) {
    const bob = Math.sin(t * 3) * w * 0.18;
    const cy = y - w * 0.85 + bob;
    const hue = t * 1.4;
    const col = [
      0.55 + 0.45 * Math.sin(hue),
      0.55 + 0.45 * Math.sin(hue + 2.1),
      0.55 + 0.45 * Math.sin(hue + 4.2),
      0.85,
    ];
    R.rotQuad(x, cy, w, w, t * 1.8, col);
    R.rotQuad(x, cy, w * 0.72, w * 0.72, -t * 1.8, [1, 1, 1, 0.35]);
    // "?" approximated with a hook and a dot
    R.arc(x, cy - w * 0.08, w * 0.13, w * 0.2, -Math.PI * 0.9, Math.PI * 0.35, [1, 1, 1, 0.95], 8);
    R.circle(x, cy + w * 0.26, w * 0.05, [1, 1, 1, 0.95], 6);
  }

  // Player missile: glowing bolt with a trail.
  function missile(x, y, w, t) {
    const cy = y - w * 0.6;
    R.circle(x, cy, w * 0.55, [1.0, 0.6, 0.2, 0.25], 10);
    R.circle(x, cy, w * 0.3, [1.0, 0.75, 0.3, 1], 10);
    R.circle(x, cy, w * 0.15, [1, 1, 1, 1], 8);
    const f = (Math.sin(t * 50) * 0.5 + 0.5) * w * 0.5;
    R.tri(x - w * 0.2, cy + w * 0.15, x + w * 0.2, cy + w * 0.15,
          x, cy + w * 0.8 + f, [1.0, 0.5, 0.1, 0.8]);
  }

  // Start/finish banner with checkered flag pattern.
  function startArch(x, y, w) {
    const h = w * 0.34;
    const pw = w * 0.04;
    R.quad(x - w * 0.55, y - h, pw, h, [0.85, 0.85, 0.9, 1]);
    R.quad(x + w * 0.55 - pw, y - h, pw, h, [0.85, 0.85, 0.9, 1]);
    const bw = w * 1.1, bh = pw * 2.6;
    const cells = 12;
    const cw = bw / cells;
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < 2; j++) {
        const col = (i + j) % 2 === 0 ? [0.95, 0.95, 1, 1] : [0.05, 0.05, 0.1, 1];
        R.quad(x - bw / 2 + i * cw, y - h - bh + j * (bh / 2), cw, bh / 2, col);
      }
    }
  }

  // Dropped mine: dark sphere with a sparking fuse.
  function bomb(x, y, w, t) {
    const cy = y - w * 0.58;
    R.circle(x, cy, w * 0.58, [0.10, 0.10, 0.14, 1], 10);
    R.circle(x, cy, w * 0.43, [0.20, 0.20, 0.26, 1], 10);
    R.circle(x - w * 0.14, cy - w * 0.15, w * 0.15, [0.45, 0.45, 0.55, 0.45], 6);
    // fuse
    R.quad(x - w * 0.04, y - w * 1.08, w * 0.08, w * 0.52, [0.65, 0.50, 0.18, 1]);
    // flickering spark
    const fl = (Math.sin((t || 0) * 28) * 0.4 + 0.7);
    R.circle(x, y - w * 1.10, w * 0.13, [1.0, 0.85, 0.2, fl], 6);
    R.circle(x, y - w * 1.10, w * 0.07, [1.0, 1.0, 0.6, fl], 5);
  }

  return { kart, cone, oil, coin, pylon, arch, startArch, itemBox, missile, bomb };
})();
