# Neon Drift

A synthwave kart racer built with raw WebGL — no frameworks, no
dependencies, no build step. Runs in any modern browser on desktop or
mobile. A sibling of [Neon Swarm](https://github.com/brycejmurrin/project1)
and [Neon Slice](https://github.com/brycejmurrin/pizza): same engine
style, this time with an engine.

The track is a classic pseudo-3D segmented road (OutRun style). Race five
rivals across three circuits — three laps each — grabbing coins, hitting
boost pads, and dodging cones and oil slicks. The headline feature:
**steer by tilting your phone**, using the device gyroscope.

## How to play

- **Mobile (tilt):** tilt the phone left/right to steer — it calibrates to
  how you're holding it at the countdown. Touch and hold anywhere to
  drift, release for a boost. On iOS the browser will ask permission to
  use motion sensors on your first tap.
- **Mobile (no gyro):** touch the left/right half of the screen to steer;
  a second finger drifts. Toggle `TILT` in the pause menu, and
  `RECALIBRATE TILT` if your neutral position changes.
- **Desktop:** `←`/`→` or `A`/`D` steer, `Space` drift (release for
  boost), `↓`/`S` brake, `P`/`Esc` pause.
- Acceleration is automatic. Drift through corners to charge a mini-boost
  — sparks turn blue when the big boost is ready.
- **Coins** are 25 points each. **Boost pads** (glowing chevrons) give a
  free boost. **Cones** spin you out; **oil** scrambles your steering —
  a well-timed drift hop clears both.
- Finish bonus: 1200 / 900 / 650 / 450 / 300 / 200 by place. Score
  accumulates across the three-race Grand Prix; the high score is saved
  locally.

## Tilt controls, technically

Steering uses the `DeviceOrientationEvent` API, remapped by
`screen.orientation.angle` so the tilt axis is correct in any screen
rotation, with a small deadzone and ~22° to full lock. iOS 13+ requires
`DeviceOrientationEvent.requestPermission()` from a user gesture, so the
permission prompt rides on the start tap. Motion sensors need a **secure
context** — serve over HTTPS (or localhost) for tilt to work.

## Running it

Any static file server works:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk also works on desktop — but for
tilt on a phone, serve it over HTTPS (e.g. GitHub Pages).
