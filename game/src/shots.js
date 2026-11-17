// The scripted pilot behind the screenshot scenes (?shot=start|play|end) and the automated tests.
// It plays the real game with the real rules — it only chooses a thrust direction, an aim point,
// the tether and the dash — so every frame it produces is a frame a player could have produced.
// Its choices depend on the world alone, so the same seed always stages the same harbour.

import { BEAM, PILOT, RING, SKIFF, STEP, TETHER, WATER } from './config.js';

const TAU = Math.PI * 2;
const DIRECTIONS = 24;

function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

/** Where a beam will point `ahead` seconds from now, exactly as sweepBeams will place it. */
function beamAngleAt(beam, time, ahead) {
  return beam.base + Math.sin((time + ahead) * beam.speed + beam.phase) * BEAM.span;
}

/**
 * How dangerous a spot is over the next second: high when a storm beam will cross it, moderate
 * when a drifting wreck will be there. Used both to steer and to decide when to dash.
 */
function threatAt(world, x, y, inclusive = 1) {
  const s = world.state;
  let threat = 0;
  for (const beam of s.beams) {
    for (let t = 0; t <= PILOT.lookAhead; t += 0.35) {
      const angle = beamAngleAt(beam, s.t, t);
      const dx = x - beam.x;
      const dy = y - beam.y;
      const d = Math.hypot(dx, dy);
      if (d > BEAM.length) continue;
      let delta = (Math.atan2(dy, dx) - angle + Math.PI) % TAU;
      if (delta < 0) delta += TAU;
      delta -= Math.PI;
      const spread = beam.width * inclusive + Math.atan2(SKIFF.radius + 8, Math.max(d, 1));
      if (Math.abs(delta) < spread) {
        threat = Math.max(threat, (PILOT.lookAhead - t) * 1000);
      }
    }
  }
  for (const wreck of s.wrecks) {
    const ahead = 0.5;
    const wx = wreck.x + wreck.vx * ahead;
    const wy = wreck.y + wreck.vy * ahead;
    if (distance(x, y, wx, wy) < wreck.radius + PILOT.wreckClear) threat = Math.max(threat, 320);
  }
  return threat;
}

/** The crate worth fetching, or the ring when the tow is full enough. */
export function pilotGoal(world) {
  const s = world.state;
  const sk = s.skiff;
  const skiffToRing = distance(sk.x, sk.y, s.ring.x, s.ring.y);
  if (s.hooks >= 1 && (s.hooks >= 3 || skiffToRing < 300)) {
    return { x: s.ring.x, y: s.ring.y, kind: 'ring' };
  }
  let best = null;
  let bestDistance = Infinity;
  for (const item of s.salvage) {
    if (item.hooked) continue;
    const d = distance(sk.x, sk.y, item.x, item.y);
    if (d < bestDistance) {
      bestDistance = d;
      best = item;
    }
  }
  const reach = s.hooks >= 1 ? 420 : 4200;
  if (best && bestDistance <= reach) return { x: best.x, y: best.y, kind: 'crate' };
  if (s.hooks >= 1) return { x: s.ring.x, y: s.ring.y, kind: 'ring' };
  if (best) return { x: best.x, y: best.y, kind: 'crate' };
  return { x: s.ring.x, y: s.ring.y, kind: 'ring' };
}

/**
 * One step of the pilot's intent: pick the heading that gets closest to the goal while staying
 * out of the storm, aim the helm at the goal, hold the tether, dash out of trouble.
 */
export function pilotIntent(world) {
  const s = world.state;
  const sk = s.skiff;
  const goal = pilotGoal(world);
  let bestDirection = { x: Math.cos(sk.angle), y: Math.sin(sk.angle) };
  let bestScore = -Infinity;

  for (let i = 0; i < DIRECTIONS; i += 1) {
    const angle = (i / DIRECTIONS) * TAU;
    const probe = 96;
    const px = sk.x + Math.cos(angle) * probe;
    const py = sk.y + Math.sin(angle) * probe;
    let score = -distance(px, py, goal.x, goal.y);
    if (px < WATER.x0 + 46 || px > WATER.x1 - 46) score -= 900;
    if (py < WATER.y0 + 60 || py > WATER.y1 - 46) score -= 900;
    score -= threatAt(world, px, py, 1.6) * 1.2;
    score -= threatAt(world, sk.x + Math.cos(angle) * probe * 0.5, sk.y + Math.sin(angle) * probe * 0.5, 1.3) * 0.6;
    score += Math.cos(angle - sk.angle) * 16; // keep a steady course rather than dithering
    if (score > bestScore) {
      bestScore = score;
      bestDirection = { x: Math.cos(angle), y: Math.sin(angle) };
    }
  }

  const toGoal = distance(sk.x, sk.y, goal.x, goal.y);
  const magnitude = goal.kind === 'crate' && toGoal < 70 ? 0.45 : toGoal < 130 ? 0.7 : 1;
  const danger = threatAt(world, sk.x, sk.y, 1.5);
  return {
    thrust: { x: bestDirection.x * magnitude, y: bestDirection.y * magnitude },
    aim: { x: goal.x, y: goal.y },
    tether: true,
    dash: danger > 0 && sk.dashCd <= 0,
  };
}

/**
 * Run the pilot for at most `seconds` of simulation, stopping early when `stop` says so. Returns
 * how far it got, which the shot staging and the tests both report.
 */
export function runPilot(world, seconds, stop = null) {
  const steps = Math.round(seconds / STEP);
  let taken = 0;
  const events = [];
  for (let i = 0; i < steps; i += 1) {
    const result = world.step(STEP, pilotIntent(world));
    taken += 1;
    for (const event of result.events) events.push(event.type);
    if (stop && stop(world)) break;
    if (result.ended) break;
  }
  return { steps: taken, events, ended: world.state.phase };
}

/**
 * Park the skiff in the open until the storm finishes it: the guarantee that `?shot=end` always
 * shows a real terminal state, even if a seed makes the quota unreachable for the pilot.
 */
function runToDefeat(world, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const result = world.step(STEP, { thrust: { x: 0, y: 0 }, aim: null, tether: false, dash: false });
    if (result.ended) break;
  }
  return world.state.phase;
}

/** Names of the scenes this module can stage. */
export const SHOTS = ['start', 'play', 'end'];

/**
 * Set the world to the named scene and return a small report. Every scene runs the real
 * simulation from a fresh reset, so the same seed draws the same frame.
 */
export function stageShot(name, world, options = {}) {
  const seed = options.seed ?? world.seed;
  const scene = SHOTS.includes(name) ? name : 'start';
  world.reset(seed);

  if (scene === 'start') {
    // The title screen over a harbour that has been turning for a while.
    for (let i = 0; i < Math.round(6 / STEP); i += 1) {
      world.step(STEP, { thrust: { x: 0, y: 0 }, aim: null, tether: false, dash: false });
    }
    return { scene, phase: world.state.phase, steps: Math.round(6 / STEP), delivered: 0, hooks: 0 };
  }

  world.start();
  if (scene === 'play') {
    // Play on until the second crate of wave one is home and a third is in tow: a frame that
    // shows the whole loop at once — the tether, the chain, the hull that has been hit, the ring.
    const report = runPilot(world, 150, (w) => {
      const s = w.state;
      const toRing = distance(s.skiff.x, s.skiff.y, s.ring.x, s.ring.y);
      return s.wave === 1 && s.delivered >= 2 && s.hooks >= 1 && s.combo >= 3 && toRing < 240;
    });
    return {
      scene,
      phase: world.state.phase,
      steps: report.steps,
      delivered: world.state.delivered,
      hooks: world.state.hooks,
    };
  }

  // The end scene: pilot the quota home; if the storm wins first, that is the terminal state.
  const report = runPilot(world, 300);
  if (world.state.phase === 'play') runToDefeat(world, 120);
  return {
    scene,
    phase: world.state.phase,
    steps: report.steps,
    delivered: world.state.totalDelivered,
    hooks: world.state.hooks,
    score: world.state.score,
    hull: world.state.hull,
  };
}

/** The pilot's own view of the ring, for tests that want to assert the goal is reachable. */
export const PILOT_RING = { x: RING.x, y: RING.y, radius: RING.radius };
export const PILOT_REACH = TETHER.range;
