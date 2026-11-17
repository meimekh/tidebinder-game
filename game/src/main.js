// The door: read the query, build the harbour, bind the devices, run the fixed-step loop and
// paint. It also owns the two things the outside world is allowed to see — the small save file in
// localStorage (best score, mute, reduced motion) and window.__gameTest, the handle the automated
// tests and the screenshot tooling drive. There is no network call anywhere in this game.

import { FIELD, MAX_FRAME_DT, STEP, STORE } from './config.js';
import { createWorld } from './simulation.js';
import { createRenderer } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { drawHints, drawHud, drawScreen } from './hud.js';
import { SHOTS, pilotIntent, stageShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const requestedShot = params.get('shot');
const shotScene = requestedShot && SHOTS.includes(requestedShot) ? requestedShot : null;
const requestedSeed = Number.parseInt(params.get('seed') ?? '1', 10);
const seed = Number.isFinite(requestedSeed) ? requestedSeed : 1;

const canvas = document.getElementById('game');
const statusLine = document.getElementById('status');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();
const world = createWorld(seed);

/** localStorage is wrapped: a browser in private mode must still play the game. */
const store = {
  read(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      /* nothing to do: the setting simply will not persist */
    }
  },
};

const settings = {
  reducedMotion: store.read(STORE.motion, '0') === '1',
  muted: store.read(STORE.muted, '0') === '1',
};
let best = Number.parseInt(store.read(STORE.best, '0'), 10) || 0;
let previousBest = best;
audio.setMuted(settings.muted);

let accumulator = 0;
let previousNow = performance.now() / 1000;
let statusTimer = 0;
let painted = false;
let lastEvents = [];
let stageReport = null; // what the shot staging did, for the screenshot tooling

function uiRecord() {
  return {
    best,
    previousBest,
    muted: settings.muted,
    reducedMotion: settings.reducedMotion,
    time: world.state.t,
  };
}

function resize() {
  renderer.resize(window.innerWidth || FIELD.width, window.innerHeight || FIELD.height, window.devicePixelRatio || 1);
}

function overlay(ctx) {
  const ui = uiRecord();
  if (world.state.phase !== 'title') drawHud(ctx, world, ui);
  drawHints(ctx, world, ui);
  drawScreen(ctx, world, ui);
}

/** A screen-reader line, so the game says what it is doing without a visible status box. */
function updateStatus(now) {
  if (now - statusTimer < 0.5) return;
  statusTimer = now;
  if (!statusLine) return;
  const s = world.state;
  const parts = [
    s.phase === 'play' ? 'Playing' : s.phase.charAt(0).toUpperCase() + s.phase.slice(1),
    `wave ${s.wave} of 3`,
    `${s.delivered} of ${s.target} cargo rescued`,
    `hull ${Math.max(0, Math.round(s.hull))}`,
    `score ${s.score}`,
  ];
  statusLine.textContent = parts.join(', ');
}

function playEvents(events) {
  for (const event of events) {
    switch (event.type) {
      case 'deliver':
        audio.event('deliver', world.state.combo);
        break;
      case 'beamHit':
        audio.event('beamHit');
        renderer.shake(9);
        break;
      case 'wreckHit':
        audio.event('wreckHit');
        renderer.shake(7);
        break;
      case 'waveStart':
      case 'waveClear':
        audio.event(event.type, world.state.wave);
        break;
      case 'win':
      case 'lose':
        audio.event(event.type);
        renderer.shake(4);
        break;
      default:
        audio.event(event.type, event.value);
        break;
    }
  }
}

function beginRun() {
  previousBest = best;
  world.start();
  audio.event('ui');
}

function handleKeys() {
  if (input.take('KeyM')) {
    settings.muted = !settings.muted;
    audio.setMuted(settings.muted);
    store.write(STORE.muted, settings.muted ? '1' : '0');
    audio.event('ui');
  }
  if (input.take('KeyO')) {
    settings.reducedMotion = !settings.reducedMotion;
    store.write(STORE.motion, settings.reducedMotion ? '1' : '0');
    audio.event('ui');
  }
  if (shotScene) return;

  const phase = world.state.phase;
  if (phase === 'title') {
    if (input.take('Enter') || input.take('Space') || input.take('PointerDown')) beginRun();
    return;
  }
  if (phase === 'play') {
    if (input.take('KeyP') || input.take('Escape')) {
      world.setPhase('paused');
      audio.event('ui');
    }
    return;
  }
  if (phase === 'paused') {
    if (input.take('KeyP') || input.take('Escape')) {
      world.setPhase('play');
      audio.event('ui');
    } else if (input.take('KeyR') || input.take('Enter')) {
      beginRun();
    }
    return;
  }
  if (phase === 'win' || phase === 'lose') {
    if (input.take('KeyR') || input.take('Enter')) {
      beginRun();
    } else if (input.take('Escape')) {
      world.reset(seed);
      audio.event('ui');
    }
  }
}

function recordBest() {
  const s = world.state;
  if (s.score > best) {
    best = s.score;
    store.write(STORE.best, best);
  }
}

function frame(nowMs) {
  const now = nowMs / 1000;
  const raw = Math.min(MAX_FRAME_DT, Math.max(0, now - previousNow));
  previousNow = now;
  let events = [];

  if (shotScene) {
    // A screenshot frame is a frozen, fully deterministic render of a real staged state.
    accumulator = 0;
  } else {
    accumulator += raw;
    let steps = 0;
    while (accumulator >= STEP && steps < 8) {
      const result = world.step(STEP, input.intent());
      for (const event of result.events) events.push(event);
      accumulator -= STEP;
      steps += 1;
      if (result.ended) break;
    }
    if (steps >= 8) accumulator = 0;
    recordBest();
  }

  handleKeys();
  input.clearEdges();
  lastEvents = events.map((event) => event.type);
  if (events.length) playEvents(events);

  renderer.draw(world, {
    dt: shotScene ? 0 : raw,
    time: world.state.t,
    reducedMotion: settings.reducedMotion,
    overlay,
  });
  updateStatus(now);

  if (!painted) {
    painted = true;
    window.__shotReady = true;
    document.body.dataset.ready = '1';
  }
  window.requestAnimationFrame(frame);
}

// --- the test handle -----------------------------------------------------------------
// No cheat UI, and nothing here is reachable from the game's own controls: these are the
// handles a test harness (or the screenshot tooling) drives the real simulation with.
window.__gameTest = {
  ready: true,
  scene: shotScene,
  seed,

  snapshot() {
    const snap = world.snapshot();
    snap.screen = snap.phase;
    snap.best = best;
    snap.muted = settings.muted;
    snap.reducedMotion = settings.reducedMotion;
    snap.shot = shotScene;
    snap.stage = stageReport;
    snap.events = lastEvents;
    return snap;
  },

  setInput(patch) {
    input.setInput(patch);
  },

  clearInput() {
    input.clearInput();
  },

  /** Advance the real simulation by `dt` seconds (in fixed steps) `count` times. */
  step(dt = STEP, count = 1) {
    let ended = null;
    for (let i = 0; i < count; i += 1) {
      const steps = Math.max(1, Math.round(dt / STEP));
      for (let k = 0; k < steps; k += 1) {
        const result = world.step(STEP, input.intent());
        for (const event of result.events) lastEvents.push(event.type);
        if (result.ended) ended = result.ended;
      }
    }
    recordBest();
    return this.snapshot();
  },

  /** Drive the scripted pilot (the same one the screenshots use) for `seconds`. */
  pilot(seconds = 1, stop = null) {
    const steps = Math.round(seconds / STEP);
    for (let i = 0; i < steps; i += 1) {
      const result = world.step(STEP, pilotIntent(world));
      for (const event of result.events) lastEvents.push(event.type);
      if (result.ended) break;
      if (stop && stop(world.snapshot())) break;
    }
    recordBest();
    return this.snapshot();
  },

  start() {
    beginRun();
    return this.snapshot();
  },

  reset(nextSeed = seed) {
    if (Number.isFinite(nextSeed)) world.reset(nextSeed);
    previousBest = best;
    return this.snapshot();
  },

  setPhase(phase) {
    world.setPhase(phase);
    return this.snapshot();
  },

  scene(name) {
    return stageShot(name, world, { seed });
  },

  /** Simulate a key: `code` down or up, exactly as the real listener would record it. */
  key(code, down = true) {
    const target = window;
    const type = down ? 'keydown' : 'keyup';
    target.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
    return this.snapshot();
  },

  /** Run the auto-advance for the frame: sim steps plus the key handling the loop does. */
  tick(dt = STEP) {
    const result = world.step(dt, input.intent());
    for (const event of result.events) lastEvents.push(event.type);
    handleKeys();
    input.clearEdges();
    recordBest();
    return this.snapshot();
  },

  draw() {
    renderer.draw(world, {
      dt: 0,
      time: world.state.t,
      reducedMotion: settings.reducedMotion,
      overlay,
    });
    return this.snapshot();
  },

  view() {
    return renderer.transform;
  },
};

// --- start ---------------------------------------------------------------------------
input.bind();
resize();
window.addEventListener('resize', resize);

// A browser only allows sound after a real gesture: create the context inside one.
function unlockAudio() {
  audio.unlock();
}
window.addEventListener('keydown', unlockAudio);
window.addEventListener('pointerdown', unlockAudio);

if (shotScene) {
  stageReport = stageShot(shotScene, world, { seed });
}
window.requestAnimationFrame(frame);
