# TIDEBINDER — storm salvage in the flooded clockwork harbour

[![make.fun bounty](https://make.fun/badge/best-game-01.svg)](https://make.fun/c/best-game-01)
[![make.fun rank](https://make.fun/badge/best-game-01/meimekh/tidebinder-game/rank.svg)](https://make.fun/c/best-game-01)
[![make.fun reward](https://make.fun/badge/best-game-01/meimekh/tidebinder-game/reward.svg)](https://make.fun/c/best-game-01)

A browser arcade game about rescuing cargo out of a storm. You fly a luminous rescue skiff around a
flooded clockwork harbour, **tether** amber salvage, haul it across the water and deliver it to the
lighthouse ring — three waves, a quota, a hull that can be scalded by storm beams and battered by
drifting wrecks, and a chain multiplier that rewards bringing cargo home in one long run. Win by
filling all three quotas; lose at zero hull. Everything is drawn on one canvas and every sound is
made by a WebAudio oscillator, so the whole game is a few small files with no assets and no
network request. See it at [make.fun](https://make.fun).

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` or the arrow keys | steer the skiff (thrust in screen space) |
| Mouse | aim the helm — the skiff turns to face the cursor; with no pointer aim the hull turns to its thrust instead |
| `Space` or left mouse button (hold) | tether the nearest salvage in range and tow it |
| Release | let the tether go and let the cargo drift |
| `Shift` | dash — a short burst of speed with a few frames of protection |
| `P` / `Esc` | pause and resume |
| `M` | mute and unmute |
| `O` | reduced motion (fewer particles, no screen shake, no water drift) |
| `R` / `Enter` | restart a finished run; `Esc` returns to the title screen |

The goal is on the screen at all times: how much cargo is rescued out of how many, what the hull has
left, the score, the chain, the wave and whether the dash is ready — the quota and the hull in
large type in the corners, the score and the chain opposite, one control line along the bottom. A
short contextual line appears over the water when there is something true to say (a crate in
reach, a tow to bring home, the chain running out, a hull about to fail) and stays off the cargo.

## Playing it

The game is static files under `game/` with no build step, so any static HTTP server works. The
kit's tiny server is included:

```
node serve.ts          # or: npx serve game
# then open http://localhost:8080
```

`game/index.html` opens offline in desktop Chrome with no network request at all: the page loads
`./src/main.js` as an ES module, and that module imports its siblings from the same folder.

## Architecture

Everything is one logical 1280x720 field that the renderer scales to the window (device pixel
ratio capped at 2, so a high-DPI display is sharp without a second texture pass). The simulation
runs on a fixed 60 Hz step with a clamped accumulator, so the game plays the same at 30 fps and at
240 fps and a stalled tab cannot jump the clock.

```
game/
  index.html          the page: a canvas, a screen-reader status line, one module script
  src/
    config.js         every tuning number and colour: the whole game's balance in one file
    random.js         seeded mulberry32 generator, so a seed gives the same harbour
    input.js          keyboard, pointer and the test/pilot intent override
    simulation.js     the rules: skiff physics, the tether, waves, hazards, scoring, win/lose
    render.js         the harbour: isometric sea, quay, gears, beams, crates, skiff, particles
    hud.js            the status panels, the wave banner and the title/pause/win/loss screens
    audio.js          WebAudio oscillators for every event, created on the first gesture
    shots.js          the scripted pilot and the ?shot=start|play|end|storm scenes
    main.js           the loop, the query string, the small save file, window.__gameTest
tools/
  shots.py            takes screenshots/ in a real browser, then checks each frame against the
                      state its page reports (the tow is really painted)
  test_game.py        plays the game in a real browser and checks every mechanic
  preview.py          prints a coarse text preview of an image, for checking composition
```

The simulation is the centre and it owns no browser: it takes an *intent* (`thrust`, `aim`,
`tether`, `dash`) and returns a list of events. The renderer, the HUD and the audio module consume
that state and those events; nothing draws itself from inside the rules. That separation is what
makes the game reproducible — `random.js` seeds the whole harbour, and `shots.js` plays the real
rules forward with a scripted pilot, so `?shot=play&seed=1` always draws the same frame.

The tether is the idea at the heart of it: it is not an inventory slot, it is a rope. While you hold
`Space` the skiff snaps onto the nearest crate in range (up to three at once), the rope drags it
along and the extra tonnage slows the skiff's acceleration and turns; let go and the cargo keeps
the speed it had. Delivering is a matter of getting the crate itself inside the lighthouse ring.
Beams cut the rope.

### The three waves

| Wave | Quota | Storm beams | Drifting wrecks | Salvage afloat |
| --- | --- | --- | --- | --- |
| First Swell | 3 | 2 | 2 | 5 |
| Rising Storm | 4 | 3 | 3 | 6 |
| Full Gale | 5 | 4 | 4 | 7 |

Each wave cleared repairs part of the hull, and finishing a wave quickly adds a time bonus. Chain
deliveries multiply: a crate delivered within seven seconds of the last one pays x2, then x3, up to
x5 — which is the difference between a careful salvage and a dangerous, beautiful one.

## Screenshot scenes

Four real renders, in the order the contact sheet reads them — the first is the cover:

| File | Scene | What it shows |
| --- | --- | --- |
| `1-play.jpg` | `?shot=play&seed=1` | live gameplay: two amber crates on the tether, the ring ahead, a storm beam and a drifting wreck in the water |
| `2-title.jpg` | `?shot=start&seed=1` | the title card: the goal, the four rules, every key |
| `3-win.jpg` | `?shot=end&seed=1` | the results screen of a run the pilot really won |
| `4-storm.jpg` | `?shot=storm&seed=1` | the last wave: four beams, three crates in tow, the ring at hand |

Every scene is the real simulation run forward by the scripted pilot in `src/shots.js`, not a
separate drawing or a mock-up. `play` and `storm` rate each live frame of the pilot's run (tether
working, ring ahead, a hazard beside the boat, the hull dented, nothing hidden under a status
panel), then replay the same deterministic run and stop on the best one, so the frame is a state
the rules actually produced, chosen for what it shows. `?shot=end` pilots the quota home; if the
storm wins first, the loss screen is the honest terminal state.

`window.__gameTest` exposes `start`, `step(dt)`, `pilot(seconds)`, `setInput(...)` and
`snapshot()` for automated tests, and `window.__shotReady` flips once the first frame has been
painted; none of it is visible in the game itself. `tools/shots.py` records each frame's snapshot
beside the image and then checks the pixels against it — the crates the snapshot says are in tow
must be amber in the image, and each rope must be a bright line between the boat and its crate —
so a blank, broken or mis-staged render fails the tool rather than shipping.

## Building the entry

`main.ts` is the only program: it copies `game/` and `screenshots/` into the output directory and
writes `dossier.json` with the kit's `buildDossier`.

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts
```

The screenshots and every check were taken against a local server, with a real browser:

```
node serve.ts &            # game/ on http://localhost:8080
python tools/shots.py      # renders screenshots/ and checks each frame
python tools/test_game.py  # drives the game: input, tether, delivery, waves, win, loss, restart
```

The repository holds the game, its screenshots, this file, `main.ts`, `serve.ts`, the tooling in
`tools/`, the vendored `vendor/makefun-game.ts` from the kit and the MIT `LICENSE`.

---

MIT licensed. Original art, sound, rules and names: no third-party assets, no third-party code,
and no commercial names.
