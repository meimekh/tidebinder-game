// The harbour's rules, and nothing else: no canvas, no sound, no browser. Every number here comes
// from config.js, every random choice comes from the seeded stream in random.js, and the whole
// state is plain data, so the same seed and the same intent always give the same harbour. The
// world also keeps a short list of ageing events (`fx`) that the renderer draws and the audio
// module sounds; the events are the only channel out of the simulation.

import {
  BEAM,
  CARGO,
  COMBO,
  DASH,
  HULL,
  PYLONS,
  RING,
  SCORE,
  SKIFF,
  SPAWN,
  TETHER,
  WAVES,
  WATER,
  WRECK,
} from './config.js';
import { createStream } from './random.js';

const TAU = Math.PI * 2;

/** An intent that moves nothing: the title screen, a win, a loss. */
export const IDLE_INTENT = { thrust: { x: 0, y: 0 }, aim: null, tether: false, dash: false };

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}

/** The signed smallest angle from one heading to another, in [-PI, PI]. */
export function angleDelta(from, to) {
  let d = (to - from + Math.PI) % TAU;
  if (d < 0) d += TAU;
  return d - Math.PI;
}

/** Step `from` toward `to` by at most `maxStep` radians. */
function approachAngle(from, to, maxStep) {
  return from + clamp(angleDelta(from, to), -maxStep, maxStep);
}

function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

/** Is the point inside the wedge a storm beam sweeps? The wedge widens with distance. */
export function beamHitsBeam(beam, x, y, radius) {
  const dx = x - beam.x;
  const dy = y - beam.y;
  const d = Math.hypot(dx, dy);
  if (d > BEAM.length + radius) return false;
  const spread = beam.width + Math.atan2(radius, Math.max(d, 1));
  return Math.abs(angleDelta(beam.angle, Math.atan2(dy, dx))) <= spread;
}

export function createWorld(seed = 1) {
  const state = {
    phase: 'title', // title | play | paused | win | lose
    t: 0,
    wave: 1,
    waveTime: 0,
    banner: null, // { text, sub, timer }
    score: 0,
    hull: HULL.max,
    combo: 1,
    comboTimer: 0,
    delivered: 0,
    target: WAVES[0].target,
    totalDelivered: 0,
    cleared: 0,
    hooks: 0,
    mass: SKIFF.mass,
    hits: 0,
    dashes: 0,
    beamHits: 0,
    wreckHits: 0,
    skiff: { x: SPAWN.skiff.x, y: SPAWN.skiff.y, vx: 0, vy: 0, angle: -0.65, invuln: 0, dashCd: 0 },
    hooked: [],
    salvage: [],
    wrecks: [],
    beams: [],
    stormTurns: 0,
    ring: { x: RING.x, y: RING.y, radius: RING.radius },
  };

  const world = {
    seed,
    state,
    rng: null, // the seeded stream, rebuilt by reset()
    fx: [], // ageing visual/audio events
    tick: [], // the events this step created

    /** Rebuild the harbour from a fresh seed, parked on the title screen. */
    reset(nextSeed = seed) {
      world.seed = nextSeed;
      world.rng = createStream((nextSeed * 2654435761) >>> 0);
      state.phase = 'title';
      state.t = 0;
      state.wave = 1;
      state.waveTime = 0;
      state.banner = null;
      state.score = 0;
      state.hull = HULL.max;
      state.combo = 1;
      state.comboTimer = 0;
      state.delivered = 0;
      state.target = WAVES[0].target;
      state.cleared = 0;
      state.totalDelivered = 0;
      state.hooks = 0;
      state.mass = SKIFF.mass;
      state.hits = 0;
      state.dashes = 0;
      state.beamHits = 0;
      state.wreckHits = 0;
      state.stormTurns = 0;
      state.skiff = { x: SPAWN.skiff.x, y: SPAWN.skiff.y, vx: 0, vy: 0, angle: -0.65, invuln: 0, dashCd: 0 };
      state.hooked = [];
      state.salvage = [];
      state.wrecks = [];
      state.beams = [];
      world.fx = [];
      world.tick = [];
      world.setupWave(0, true);
      return state;
    },

    /** Begin a run: a fresh wave-one harbour from the same seed, hull full, quota at three. */
    start() {
      state.phase = 'play';
      state.score = 0;
      state.hull = HULL.max;
      state.combo = 1;
      state.comboTimer = 0;
      state.delivered = 0;
      state.cleared = 0;
      state.totalDelivered = 0;
      state.hits = 0;
      state.dashes = 0;
      state.beamHits = 0;
      state.wreckHits = 0;
      state.waveTime = 0;
      state.skiff = {
        x: SPAWN.skiff.x,
        y: SPAWN.skiff.y,
        vx: 0,
        vy: 0,
        angle: -0.65,
        invuln: 1.5, // a moment of grace: a beam cannot be sweeping the berth at spawn
        dashCd: 0,
      };
      state.hooked = [];
      state.salvage = [];
      state.wrecks = [];
      state.beams = [];
      // The seeded stream has not moved since the last layout, so this redraws the very
      // harbour the title screen showed: crates where the player last saw them.
      world.setupWave(0, true);
      world.announce(`WAVE 1 · ${WAVES[0].name}`, `RESCUE ${state.target} CARGO`, 3);
      return state;
    },

    setPhase(phase) {
      state.phase = phase;
      return state;
    },

    /** A short nudge of marquee text over the water. */
    announce(text, sub, seconds = 2.6) {
      state.banner = { text, sub, timer: seconds };
    },

    /** Every event this step made, for the audio module. */
    drain() {
      return world.tick;
    },

    /** How the hull carries its towed tonnage: the skiff's own mass plus each hooked wreck. */
    totalMass() {
      let mass = SKIFF.mass;
      for (const item of state.hooked) mass += item.mass;
      return mass;
    },

    /** Lay out one wave's hazards: beams on their pylons, wrecks drifting in, salvage afloat. */
    setupWave(index, first = false) {
      const wave = WAVES[index];
      state.wave = index + 1;
      state.target = wave.target;
      state.beams = wave.pylons.map((pylon, i) => ({
        x: PYLONS[pylon].x,
        y: PYLONS[pylon].y,
        base: PYLONS[pylon].base,
        phase: world.rng.range(0, TAU),
        speed: wave.beamSpeed * world.rng.range(0.85, 1.15),
        width: wave.beamWidth,
        angle: PYLONS[pylon].base,
        index: i,
      }));
      const wrecks = first ? wave.wrecks : wave.wrecks;
      for (let i = 0; i < wrecks; i += 1) state.wrecks.push(world.spawnWreck(state.t));
      for (let i = 0; i < wave.salvage; i += 1) state.salvage.push(world.spawnSalvage());
    },

    /** A wreck, drifting in from one edge of the harbour. */
    spawnWreck(time) {
      const edge = world.rng.int(0, 3);
      const margin = 60;
      let x;
      let y;
      let angle;
      if (edge === 0) {
        x = world.rng.range(WATER.x0 + margin, WATER.x1 - margin);
        y = WATER.y0 - margin;
        angle = Math.PI / 2;
      } else if (edge === 1) {
        x = WATER.x1 + margin;
        y = world.rng.range(WATER.y0 + margin, WATER.y1 - margin);
        angle = Math.PI;
      } else if (edge === 2) {
        x = world.rng.range(WATER.x0 + margin, WATER.x1 - margin);
        y = WATER.y1 + margin;
        angle = -Math.PI / 2;
      } else {
        x = WATER.x0 - margin;
        y = world.rng.range(WATER.y0 + margin, WATER.y1 - margin);
        angle = 0;
      }
      angle += world.rng.range(-0.5, 0.5);
      const speed = WRECK.speed + world.rng.range(0, WRECK.speedJitter);
      return {
        id: `w${state.wrecks.length}-${Math.round(time * 60)}`,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: WRECK.radius + world.rng.range(0, 8),
        spin: world.rng.range(-WRECK.spin, WRECK.spin),
        angle: world.rng.range(0, TAU),
        seed: world.rng.range(0, TAU),
      };
    },

    /** A crate of amber salvage, dropped where it is reachable but not free to fetch. */
    spawnSalvage() {
      for (let attempt = 0; attempt < 48; attempt += 1) {
        const x = world.rng.range(SPAWN.x[0], SPAWN.x[1]);
        const y = world.rng.range(SPAWN.y[0], SPAWN.y[1]);
        if (distance(x, y, state.ring.x, state.ring.y) < SPAWN.clearRing) continue;
        if (distance(x, y, SPAWN.skiff.x, SPAWN.skiff.y) < SPAWN.clearSkiff) continue;
        let crowded = false;
        for (const item of state.salvage) {
          if (distance(x, y, item.x, item.y) < 96) {
            crowded = true;
            break;
          }
        }
        if (crowded) continue;
        return world.makeSalvage(x, y);
      }
      return world.makeSalvage(
        world.rng.range(SPAWN.x[0], SPAWN.x[1]),
        world.rng.range(SPAWN.y[0], SPAWN.y[1]),
      );
    },

    makeSalvage(x, y) {
      const drift = WAVES[Math.min(state.wave, WAVES.length) - 1].drift;
      const heading = world.rng.angle();
      const speed = world.rng.range(0, drift);
      return {
        id: `s${state.salvage.length + state.delivered}-${Math.round(state.t * 60)}`,
        x,
        y,
        vx: Math.cos(heading) * speed,
        vy: Math.sin(heading) * speed,
        mass: CARGO.mass,
        radius: CARGO.radius,
        hooked: false,
        delivered: false,
        bob: world.rng.range(0, TAU),
        spin: world.rng.range(0, TAU),
      };
    },

    /** The beams turn whether anyone is playing or not: they are the harbour's weather. */
    sweepBeams(dt) {
      for (const beam of state.beams) {
        beam.angle = beam.base + Math.sin(state.t * beam.speed + beam.phase) * BEAM.span;
      }
    },

    /** Loose salvage drifts; hooked salvage answers to the rope in runTether. */
    driftSalvage(dt) {
      for (const item of state.salvage) {
        if (item.hooked) continue;
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        if (item.x < WATER.x0 + 20) {
          item.x = WATER.x0 + 20;
          item.vx = Math.abs(item.vx);
        } else if (item.x > WATER.x1 - 20) {
          item.x = WATER.x1 - 20;
          item.vx = -Math.abs(item.vx);
        }
        if (item.y < WATER.y0 + 20) {
          item.y = WATER.y0 + 20;
          item.vy = Math.abs(item.vy);
        } else if (item.y > WATER.y1 - 20) {
          item.y = WATER.y1 - 20;
          item.vy = -Math.abs(item.vy);
        }
      }
    },

    /** Wrecks drift on across the harbour, turning as they go, bouncing off the quay walls. */
    driftWrecks(dt) {
      for (const wreck of state.wrecks) {
        wreck.x += wreck.vx * dt;
        wreck.y += wreck.vy * dt;
        wreck.angle += wreck.spin * dt;
        const pad = wreck.radius + 8;
        if (wreck.x < WATER.x0 + pad) {
          wreck.x = WATER.x0 + pad;
          wreck.vx = Math.abs(wreck.vx);
        } else if (wreck.x > WATER.x1 - pad) {
          wreck.x = WATER.x1 - pad;
          wreck.vx = -Math.abs(wreck.vx);
        }
        if (wreck.y < WATER.y0 + pad) {
          wreck.y = WATER.y0 + pad;
          wreck.vy = Math.abs(wreck.vy);
        } else if (wreck.y > WATER.y1 - pad) {
          wreck.y = WATER.y1 - pad;
          wreck.vy = -Math.abs(wreck.vy);
        }
      }
    },

    /** Thrust, drag, the aiming rudder and the dash, all scaled by the towed mass. */
    driveSkiff(dt, intent) {
      const sk = state.skiff;
      const mass = world.totalMass();
      const thrust = intent.thrust ?? IDLE_INTENT.thrust;
      const accel = SKIFF.thrust / (1 + SKIFF.accelMassPenalty * (mass - 1));
      sk.vx += thrust.x * accel * dt;
      sk.vy += thrust.y * accel * dt;

      const drag = Math.exp(-SKIFF.drag * dt);
      sk.vx *= drag;
      sk.vy *= drag;
      const speed = Math.hypot(sk.vx, sk.vy);
      if (speed > SKIFF.maxSpeed) {
        const scale = SKIFF.maxSpeed / speed;
        sk.vx *= scale;
        sk.vy *= scale;
      }

      if (intent.aim) {
        const wanted = Math.atan2(intent.aim.y - sk.y, intent.aim.x - sk.x);
        const rate = SKIFF.turn / (1 + SKIFF.turnMassPenalty * (mass - 1));
        sk.angle = approachAngle(sk.angle, wanted, rate * dt);
      }

      sk.invuln = Math.max(0, sk.invuln - dt);
      sk.dashCd = Math.max(0, sk.dashCd - dt);
      if (intent.dash && state.phase === 'play' && sk.dashCd <= 0) {
        let dx = thrust.x;
        let dy = thrust.y;
        if (Math.hypot(dx, dy) < 0.2) {
          dx = Math.cos(sk.angle);
          dy = Math.sin(sk.angle);
        }
        const length = Math.hypot(dx, dy) || 1;
        sk.vx += (dx / length) * DASH.impulse;
        sk.vy += (dy / length) * DASH.impulse;
        sk.dashCd = DASH.cooldown * (1 + DASH.massPenalty * (mass - 1));
        sk.invuln = Math.max(sk.invuln, DASH.invulnerable);
        state.dashes += 1;
        world.push('dash', sk.x, sk.y, 0, 0.5, sk.angle);
      }

      sk.x += sk.vx * dt;
      sk.y += sk.vy * dt;

      const left = WATER.x0 + SKIFF.radius;
      const right = WATER.x1 - SKIFF.radius;
      const top = WATER.y0 + SKIFF.radius + 18;
      const bottom = WATER.y1 - SKIFF.radius;
      if (sk.x < left) {
        sk.x = left;
        sk.vx = Math.abs(sk.vx) * 0.3;
      } else if (sk.x > right) {
        sk.x = right;
        sk.vx = -Math.abs(sk.vx) * 0.3;
      }
      if (sk.y < top) {
        sk.y = top;
        sk.vy = Math.abs(sk.vy) * 0.3;
      } else if (sk.y > bottom) {
        sk.y = bottom;
        sk.vy = -Math.abs(sk.vy) * 0.3;
      }
    },

    /** Hook the nearest loose salvage while the tether is held, tow it, or let it drift. */
    runTether(dt, intent) {
      const sk = state.skiff;
      if (!intent.tether) {
        for (const item of state.hooked) {
          item.hooked = false;
          world.push('release', item.x, item.y, 0, 0.4);
        }
        state.hooked = [];
        state.hooks = 0;
        return;
      }

      while (state.hooked.length < TETHER.maxHooks) {
        let best = null;
        let bestDistance = TETHER.range;
        for (const item of state.salvage) {
          if (item.hooked) continue;
          const d = distance(sk.x, sk.y, item.x, item.y);
          if (d <= bestDistance) {
            bestDistance = d;
            best = item;
          }
        }
        if (!best) break;
        best.hooked = true;
        state.hooked.push(best);
        world.push('attach', best.x, best.y, 0, 0.5);
      }

      const survivors = [];
      for (const item of state.hooked) {
        const dx = sk.x - item.x;
        const dy = sk.y - item.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        if (d > TETHER.snapDistance) {
          item.hooked = false;
          world.push('snap', item.x, item.y, 0, 0.6);
          continue;
        }
        if (d > TETHER.ropeRest) {
          const nx = dx / d;
          const ny = dy / d;
          const pull = Math.min(TETHER.spring * (d - TETHER.ropeRest), TETHER.maxPull);
          item.vx += nx * pull * dt;
          item.vy += ny * pull * dt;
          const share = pull * (item.mass / (SKIFF.mass + item.mass)) * TETHER.reaction;
          sk.vx -= nx * share * dt;
          sk.vy -= ny * share * dt;
          const rel = (item.vx - sk.vx) * nx + (item.vy - sk.vy) * ny;
          if (rel > 0) {
            const damp = rel * TETHER.damp * dt;
            item.vx -= nx * damp;
            item.vy -= ny * damp;
            sk.vx += nx * damp * (item.mass / (SKIFF.mass + item.mass));
            sk.vy += ny * damp * (item.mass / (SKIFF.mass + item.mass));
          }
        }
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        item.x = clamp(item.x, WATER.x0 + 18, WATER.x1 - 18);
        item.y = clamp(item.y, WATER.y0 + 18, WATER.y1 - 18);
        survivors.push(item);
      }
      state.hooked = survivors;
      state.hooks = survivors.length;
    },

    /** Cargo that reaches the lighthouse ring is rescued: score it, chain it, cut it loose. */
    resolveDelivery() {
      if (state.hooked.length === 0) return;
      const kept = [];
      for (const item of state.hooked) {
        if (distance(item.x, item.y, state.ring.x, state.ring.y) < state.ring.radius) {
          const points = CARGO.value * state.combo;
          state.score += points;
          state.delivered += 1;
          state.totalDelivered += 1;
          item.hooked = false;
          item.delivered = true;
          world.push('deliver', item.x, item.y, points, 1.1);
          state.comboTimer = COMBO.window;
          state.combo = Math.min(COMBO.max, state.combo + 1);
        } else {
          kept.push(item);
        }
      }
      if (kept.length !== state.hooked.length) {
        state.hooked = kept;
        state.hooks = kept.length;
        state.salvage = state.salvage.filter((item) => !item.delivered);
      }
    },

    /** The chain multiplier decays if you leave the crates too long. */
    tickCombo(dt) {
      if (state.comboTimer <= 0) return;
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) {
        state.comboTimer = 0;
        state.combo = 1;
      }
    },

    /** Storm beams scald the hull and cut the rope; drifting wrecks batter it. */
    resolveHazards(dt) {
      const sk = state.skiff;

      for (const beam of state.beams) {
        if (!beamHitsBeam(beam, sk.x, sk.y, SKIFF.radius)) continue;
        if (sk.invuln > 0) break;
        state.hull -= HULL.beamDamage;
        state.beamHits += 1;
        state.hits += 1;
        sk.invuln = HULL.beamInvulnerable;
        const away = Math.atan2(sk.y - beam.y, sk.x - beam.x);
        sk.vx += Math.cos(away) * 190;
        sk.vy += Math.sin(away) * 190;
        for (const item of state.hooked) {
          item.hooked = false;
          world.push('cut', item.x, item.y, 0, 0.7);
        }
        state.hooked = [];
        state.hooks = 0;
        world.push('beamHit', sk.x, sk.y, HULL.beamDamage, 1.0, beam.angle);
        if (state.hull <= 0) {
          world.lose();
          return;
        }
        break;
      }

      for (const wreck of state.wrecks) {
        const d = distance(sk.x, sk.y, wreck.x, wreck.y) || 0.0001;
        const overlap = wreck.radius + SKIFF.radius - d;
        if (overlap <= 0) continue;
        const nx = (sk.x - wreck.x) / d;
        const ny = (sk.y - wreck.y) / d;
        sk.x += nx * overlap * 0.7;
        sk.y += ny * overlap * 0.7;
        wreck.x -= nx * overlap * 0.3;
        wreck.y -= ny * overlap * 0.3;
        sk.vx += nx * 120;
        sk.vy += ny * 120;
        if (sk.invuln > 0) continue;
        state.hull -= HULL.wreckDamage;
        state.wreckHits += 1;
        state.hits += 1;
        sk.invuln = HULL.wreckInvulnerable;
        world.push('wreckHit', sk.x, sk.y, HULL.wreckDamage, 0.9, Math.atan2(ny, nx));
        if (state.hull <= 0) {
          world.lose();
          return;
        }
      }

      for (const wreck of state.wrecks) {
        for (const item of state.salvage) {
          if (item.hooked) continue;
          const d = distance(item.x, item.y, wreck.x, wreck.y) || 0.0001;
          const overlap = wreck.radius + item.radius - d;
          if (overlap <= 0) continue;
          const nx = (item.x - wreck.x) / d;
          const ny = (item.y - wreck.y) / d;
          item.x += nx * overlap;
          item.y += ny * overlap;
          item.vx += nx * 40;
          item.vy += ny * 40;
        }
      }
    },

    /** Fill the quota to advance; fill the last quota to win. */
    advanceWave(dt) {
      state.waveTime += dt;
      if (state.delivered < state.target) return;
      const bonus =
        SCORE.waveBase * state.wave +
        Math.max(0, Math.round(SCORE.timeWindow - state.waveTime)) * SCORE.timeRate;
      state.score += bonus;
      state.cleared += 1;
      state.stormTurns += 1;
      world.push('waveClear', state.ring.x, state.ring.y, bonus, 1.6);
      if (state.wave >= WAVES.length) {
        world.win();
        return;
      }
      const next = state.wave; // setupWave takes a zero-based index
      state.hull = Math.min(HULL.max, state.hull + HULL.waveRepair);
      state.delivered = 0;
      state.waveTime = 0;
      state.skiff.invuln = Math.max(state.skiff.invuln, 0.8); // a breath between waves
      world.setupWave(next, false);
      world.push('waveStart', state.ring.x, state.ring.y, state.wave, 1.6);
      world.announce(`WAVE ${state.wave} · ${WAVES[state.wave - 1].name}`, `RESCUE ${state.target} CARGO`, 2.8);
    },

    win() {
      state.phase = 'win';
      const rescue = SCORE.winBonus + Math.round(Math.max(0, state.hull) * SCORE.hullBonus);
      state.score += rescue;
      state.winBonus = rescue;
      world.push('win', state.ring.x, state.ring.y, rescue, 2.6);
    },

    lose() {
      state.phase = 'lose';
      state.hull = 0;
      const sk = state.skiff;
      for (const item of state.hooked) item.hooked = false;
      state.hooked = [];
      state.hooks = 0;
      world.push('lose', sk.x, sk.y, 0, 2.6);
    },

    /** Age the event list and add one new event. */
    push(type, x, y, value = 0, ttl = 0.8, angle = 0) {
      const event = { type, x, y, value, ttl, angle, age: 0 };
      world.fx.push(event);
      world.tick.push(event);
      if (world.fx.length > 400) world.fx.splice(0, world.fx.length - 400);
      return event;
    },

    ageEvents(dt) {
      if (world.fx.length === 0) return;
      const kept = [];
      for (const event of world.fx) {
        event.age += dt;
        if (event.age < event.ttl) kept.push(event);
      }
      world.fx = kept;
    },

    /**
     * Advance one fixed step. Returns the events this step made and whether the run ended this
     * step, so a caller (the loop, the tests, the pilot) never has to diff the whole state.
     */
    step(dt, intent = IDLE_INTENT) {
      world.tick = [];
      const s = state;
      if (s.phase === 'paused') return { events: world.tick, ended: null };
      if (s.banner) {
        s.banner.timer -= dt;
        if (s.banner.timer <= 0) s.banner = null;
      }
      s.t += dt;
      world.ageEvents(dt);
      world.sweepBeams(dt);
      world.driftSalvage(dt);
      world.driftWrecks(dt);
      if (s.phase === 'play') {
        world.driveSkiff(dt, intent);
        world.runTether(dt, intent);
        world.resolveDelivery();
        world.tickCombo(dt);
        world.resolveHazards(dt);
        world.advanceWave(dt);
      } else {
        world.driveSkiff(dt, IDLE_INTENT);
      }
      let ended = null;
      if (s.phase === 'win') ended = 'win';
      else if (s.phase === 'lose') ended = 'lose';
      return { events: world.tick, ended };
    },

    /** A plain, serialisable view of the run for the tests and the HUD. */
    snapshot() {
      const s = state;
      return {
        phase: s.phase,
        t: s.t,
        wave: s.wave,
        waveName: WAVES[Math.min(s.wave, WAVES.length) - 1].name,
        waveTime: s.waveTime,
        banner: s.banner ? s.banner.text : null,
        score: s.score,
        hull: s.hull,
        combo: s.combo,
        comboTimer: s.comboTimer,
        delivered: s.delivered,
        target: s.target,
        totalDelivered: s.totalDelivered,
        cleared: s.cleared,
        hits: s.hits,
        beamHits: s.beamHits,
        wreckHits: s.wreckHits,
        dashes: s.dashes,
        hooks: s.hooks,
        mass: world.totalMass(),
        dashReady: s.skiff.dashCd <= 0,
        dashCooldown: s.skiff.dashCd,
        invulnerable: s.skiff.invuln > 0,
        skiff: { x: s.skiff.x, y: s.skiff.y, vx: s.skiff.vx, vy: s.skiff.vy, angle: s.skiff.angle },
        salvage: s.salvage.map((item) => ({
          x: item.x,
          y: item.y,
          hooked: item.hooked,
          delivered: item.delivered,
        })),
        wrecks: s.wrecks.map((wreck) => ({ x: wreck.x, y: wreck.y, radius: wreck.radius })),
        beams: s.beams.map((beam) => ({ x: beam.x, y: beam.y, angle: beam.angle })),
        ring: { x: s.ring.x, y: s.ring.y, radius: s.ring.radius },
        events: world.fx.length,
      };
    },
  };

  world.reset(seed);
  return world;
}
