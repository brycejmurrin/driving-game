/*
 * Input: gyro tilt steering with touch and keyboard fallbacks.
 *
 * Tilt comes from the DeviceOrientationEvent API. Which euler angle maps
 * to a physical left-right tilt depends on how the screen is rotated, so
 * we remap by screen.orientation.angle. iOS 13+ gates the sensor behind
 * DeviceOrientationEvent.requestPermission(), which may only be called
 * from a user gesture — requestGyro() must be invoked from the start tap.
 *
 * Steering sources, by priority: keyboard (if held) > tilt (if enabled
 * and delivering data) > touch halves. When tilt is steering, any touch
 * on the canvas is the drift/hop button; with touch steering, a second
 * finger drifts.
 */
"use strict";

const Input = (function () {
  const MAX_TILT = 22;      // degrees of tilt for full steering lock
  const DEADZONE = 1.5;     // degrees ignored around the calibrated zero

  let keyLeft = false;
  let keyRight = false;
  let keyDrift = false;
  let keyBrake = false;

  let touchSteer = 0;       // -1 | 0 | 1 from screen halves
  let touchDrift = false;
  let buttonDrift = false;  // on-screen DRIFT button held
  let firePressed = false;  // weapon trigger, consumed by the game
  const touches = new Map(); // id -> role: "steer" | "drift"

  let tiltRaw = 0;          // latest remapped tilt, degrees
  let tiltZero = 0;         // calibrated neutral
  let gyroSeen = false;     // we have actually received sensor data
  let gyroDenied = false;
  let useTilt = true;       // player preference (pause menu toggle)

  let onPauseCb = null;

  function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === "number") {
      return screen.orientation.angle;
    }
    return typeof window.orientation === "number" ? window.orientation : 0;
  }

  function onOrient(e) {
    if (e.beta === null && e.gamma === null) return;
    const beta = e.beta || 0;
    const gamma = e.gamma || 0;
    let t;
    switch (((screenAngle() % 360) + 360) % 360) {
      case 90:  t = beta;   break;
      case 180: t = -gamma; break;
      case 270: t = -beta;  break;
      default:  t = gamma;  break;
    }
    tiltRaw = t;
    gyroSeen = true;
  }

  // Must be called from a user gesture (iOS permission prompt).
  // Resolves true if tilt data can be expected.
  function requestGyro() {
    if (typeof DeviceOrientationEvent === "undefined") {
      gyroDenied = true;
      return Promise.resolve(false);
    }
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      return DeviceOrientationEvent.requestPermission()
        .then(function (res) {
          if (res === "granted") {
            window.addEventListener("deviceorientation", onOrient);
            return true;
          }
          gyroDenied = true;
          return false;
        })
        .catch(function () {
          gyroDenied = true;
          return false;
        });
    }
    window.addEventListener("deviceorientation", onOrient);
    return Promise.resolve(true);
  }

  function calibrate() {
    tiltZero = Math.max(-35, Math.min(35, tiltRaw));
  }

  function tiltSteering() {
    let d = tiltRaw - tiltZero;
    if (Math.abs(d) < DEADZONE) return 0;
    d -= Math.sign(d) * DEADZONE;
    return Math.max(-1, Math.min(1, d / (MAX_TILT - DEADZONE)));
  }

  function steer() {
    const k = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
    if (k !== 0) return k;
    if (useTilt && gyroSeen) return tiltSteering();
    return touchSteer;
  }

  function drifting() {
    return keyDrift || touchDrift || buttonDrift;
  }

  function setButtonDrift(v) {
    buttonDrift = !!v;
  }

  function pressFire() {
    firePressed = true;
  }

  function consumeFire() {
    const f = firePressed;
    firePressed = false;
    return f;
  }

  function braking() {
    return keyBrake;
  }

  function tiltActive() {
    return useTilt && gyroSeen;
  }

  function onKey(e, down) {
    switch (e.code) {
      case "ArrowLeft": case "KeyA": keyLeft = down; break;
      case "ArrowRight": case "KeyD": keyRight = down; break;
      case "Space": keyDrift = down; e.preventDefault(); break;
      case "ArrowDown": case "KeyS": keyBrake = down; break;
      case "KeyX": case "ControlLeft": case "ControlRight":
        if (down) firePressed = true;
        break;
      case "KeyP": case "Escape":
        if (down && onPauseCb) onPauseCb();
        break;
    }
  }

  function touchRole() {
    // First finger steers unless tilt is doing that job; extra fingers drift.
    if (tiltActive()) return "drift";
    for (const role of touches.values()) {
      if (role === "steer") return "drift";
    }
    return "steer";
  }

  function applyTouches() {
    touchSteer = 0;
    touchDrift = false;
    for (const [, role] of touches) {
      if (role === "drift") touchDrift = true;
    }
  }

  function onTouchStart(e) {
    for (const t of e.changedTouches) {
      const role = touchRole();
      touches.set(t.identifier, role);
      if (role === "steer") {
        touchSteer = t.clientX < window.innerWidth / 2 ? -1 : 1;
      }
    }
    applyTouches();
  }

  function onTouchMove(e) {
    for (const t of e.changedTouches) {
      if (touches.get(t.identifier) === "steer") {
        touchSteer = t.clientX < window.innerWidth / 2 ? -1 : 1;
      }
    }
  }

  function onTouchEnd(e) {
    for (const t of e.changedTouches) {
      if (touches.get(t.identifier) === "steer") touchSteer = 0;
      touches.delete(t.identifier);
    }
    applyTouches();
  }

  function init(canvas, opts) {
    onPauseCb = (opts && opts.onPause) || null;
    window.addEventListener("keydown", function (e) { onKey(e, true); });
    window.addEventListener("keyup", function (e) { onKey(e, false); });
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd, { passive: true });
    canvas.addEventListener("touchcancel", onTouchEnd, { passive: true });

    // Mouse fallback so desktop testing works without a keyboard.
    canvas.addEventListener("mousedown", function (e) {
      touchSteer = e.clientX < window.innerWidth / 2 ? -1 : 1;
    });
    window.addEventListener("mouseup", function () { touchSteer = 0; });
  }

  function reset() {
    touches.clear();
    touchSteer = 0;
    touchDrift = false;
    buttonDrift = false;
    firePressed = false;
    keyLeft = keyRight = keyDrift = keyBrake = false;
  }

  return {
    init,
    reset,
    requestGyro,
    calibrate,
    steer,
    drifting,
    braking,
    tiltActive,
    setButtonDrift,
    pressFire,
    consumeFire,
    get gyroSeen() { return gyroSeen; },
    get gyroDenied() { return gyroDenied; },
    get useTilt() { return useTilt; },
    set useTilt(v) { useTilt = !!v; },
  };
})();
