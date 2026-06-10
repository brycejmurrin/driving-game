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
   * boostGlow draws exhaust flames, drift kicks the rear out.
   */
  function kart(x, y, w, color, opts) {
    const o = opts || {};
    const steer = o.steer || 0;
    const hop = (o.hop || 0) * w * 0.25;
    const drift = o.drift || 0;
    const h = w * 0.62;
    y -= hop;

    const lean = steer * 0.18 + drift * 0.3;
    const cx = x;
    const by = y;            // bottom (wheel contact)
    const skew = lean * w * 0.5;

    // underglow
    R.circle(cx, by + h * 0.04, w * 0.62, shade(color, 1.2, 0.16), 14);

    // rear wheels
    const wy = by - h * 0.16;
    const ww = w * 0.21, wh = h * 0.32;
    R.rotQuad(cx - w * 0.42 + skew * 0.3, wy, ww, wh, lean * 0.5, [0.05, 0.05, 0.08, 1]);
    R.rotQuad(cx + w * 0.42 + skew * 0.3, wy, ww, wh, lean * 0.5, [0.05, 0.05, 0.08, 1]);
    // hubcap glow
    R.circle(cx - w * 0.42 + skew * 0.3, wy, ww * 0.22, shade(color, 1.4), 8);
    R.circle(cx + w * 0.42 + skew * 0.3, wy, ww * 0.22, shade(color, 1.4), 8);

    // body: trapezoid leaning with steer
    const bw = w * 0.74;
    const bh = h * 0.42;
    const bx = cx + skew * 0.5;
    R.quadP(
      bx - bw * 0.38 - skew * 0.4, by - bh - h * 0.18,
      bx + bw * 0.38 - skew * 0.4, by - bh - h * 0.18,
      bx + bw * 0.5, by - h * 0.10,
      bx - bw * 0.5, by - h * 0.10,
      shade(color, 1.0)
    );
    // body highlight strip
    R.quadP(
      bx - bw * 0.38 - skew * 0.4, by - bh - h * 0.18,
      bx + bw * 0.38 - skew * 0.4, by - bh - h * 0.18,
      bx + bw * 0.40 - skew * 0.32, by - bh - h * 0.06,
      bx - bw * 0.40 - skew * 0.32, by - bh - h * 0.06,
      shade(color, 1.5)
    );

    // spoiler
    const sy = by - bh - h * 0.30;
    R.quadP(
      bx - bw * 0.45 - skew * 0.7, sy,
      bx + bw * 0.45 - skew * 0.7, sy,
      bx + bw * 0.36 - skew * 0.5, sy + h * 0.10,
      bx - bw * 0.36 - skew * 0.5, sy + h * 0.10,
      shade(color, 0.7)
    );

    // driver helmet
    R.circle(bx - skew * 0.5, by - bh - h * 0.22, w * 0.13, [0.95, 0.95, 1.0, 1], 10);
    R.circle(bx - skew * 0.5, by - bh - h * 0.22, w * 0.13, shade(color, 0.5, 0.45), 10);

    // exhaust flames while boosting
    if (o.boost) {
      const t = o.time || 0;
      const fl = (Math.sin(t * 40) * 0.5 + 0.5) * w * 0.3 + w * 0.2;
      R.tri(cx - w * 0.18, by - h * 0.05, cx - w * 0.05, by - h * 0.05,
            cx - w * 0.115, by + fl, [1.0, 0.7, 0.2, 0.9]);
      R.tri(cx + w * 0.05, by - h * 0.05, cx + w * 0.18, by - h * 0.05,
            cx + w * 0.115, by + fl, [0.3, 0.8, 1.0, 0.9]);
    }
    // drift sparks
    if (Math.abs(drift) > 0.01 && o.charge) {
      const sc = o.charge > 1 ? [0.3, 0.9, 1.0, 0.9] : [1.0, 0.8, 0.2, 0.9];
      const t = o.time || 0;
      for (let i = 0; i < 3; i++) {
        const a = t * 30 + i * 2.1;
        const sx = cx - Math.sign(drift) * w * 0.45 + Math.sin(a) * w * 0.1;
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

  return { kart, cone, oil, coin, pylon, arch, startArch };
})();
