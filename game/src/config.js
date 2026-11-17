// Every tuning number, colour and layout constant TIDEBINDER uses, in one place. The harbour is a
// fixed 1280x720 logical field; the renderer scales it to the window, so no rule below depends on
// the real screen size. Nothing here has a side effect: importing this module only reads numbers.

/** The logical playfield: 16:10, so the canvas and the screenshots share one shape. */
export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** How far a single frame is allowed to advance the clock, so a stall cannot jump the sim. */
export const MAX_FRAME_DT = 0.1;

/** The water the skiff may cross, and where the isometric tile grid is drawn. */
export const WATER = { x0: 28, y0: 104, x1: 1252, y1: 692 };

/** The rescue skiff: a light, drift-prone hull. Mass 1 is the hull itself; each towed wreck adds. */
export const SKIFF = {
  radius: 15,
  mass: 1,
  thrust: 1060,
  drag: 2.4,
  maxSpeed: 340,
  turn: 8.6,
  turnMassPenalty: 0.18,
  accelMassPenalty: 0.26,
  bobAmplitude: 2.1,
  bobSpeed: 2.2,
};

/** The tether: reach, rope length, spring and the strain that snaps a tow. */
export const TETHER = {
  range: 272,
  ropeRest: 74,
  spring: 11,
  maxPull: 1450,
  damp: 2.4,
  reaction: 0.55,
  snapDistance: 430,
  maxHooks: 3,
};

/** Salvage cargo: what a rescued wreck is worth and how heavy it is to haul. */
export const CARGO = { value: 100, mass: 1, radius: 13, drift: 1 };

/** Chain delivery: deliver again inside the window to multiply. */
export const COMBO = { window: 7, max: 5 };

/** The cooldown dash on Shift. */
export const DASH = { impulse: 430, cooldown: 2.4, invulnerable: 0.35, massPenalty: 0.12 };

/** Hull health and what the two hazards take off it. */
export const HULL = {
  max: 100,
  beamDamage: 16,
  wreckDamage: 12,
  beamInvulnerable: 1.15,
  wreckInvulnerable: 0.9,
  waveRepair: 18,
};

/** The storm beams: pylons along the quay, each sweeping a wide wedge across the harbour. */
export const PYLONS = [
  { x: 196, y: 150, base: 1.32 },
  { x: 596, y: 142, base: 1.57 },
  { x: 1000, y: 150, base: 1.83 },
  { x: 1396, y: 142, base: 2.1 },
];

export const BEAM = { length: 1020, span: 0.85, width: 0.05 };

/** The three waves: quota, hazards and how fast the storm moves. */
export const WAVES = [
  {
    name: 'FIRST SWELL',
    target: 3,
    wrecks: 2,
    pylons: [1, 2],
    beamSpeed: 0.55,
    beamWidth: 0.05,
    salvage: 5,
    drift: 22,
  },
  {
    name: 'RISING STORM',
    target: 4,
    wrecks: 3,
    pylons: [0, 2, 3],
    beamSpeed: 0.78,
    beamWidth: 0.052,
    salvage: 6,
    drift: 30,
  },
  {
    name: 'FULL GALE',
    target: 5,
    wrecks: 4,
    pylons: [0, 1, 2, 3],
    beamSpeed: 1.0,
    beamWidth: 0.056,
    salvage: 7,
    drift: 38,
  },
];

/** Scoring: a rescued wreck, a cleared wave, finishing quickly and finishing whole. */
export const SCORE = {
  waveBase: 150,
  timeWindow: 180,
  timeRate: 2,
  winBonus: 300,
  hullBonus: 2,
};

/** Drifting wreck hazards. */
export const WRECK = { radius: 32, speed: 34, speedJitter: 28, spin: 0.5 };

/** The lighthouse delivery ring in the south-east, and the tower behind it. */
export const RING = { x: 1116, y: 596, radius: 116 };

/** Where a fresh run begins, and how far from it and the ring salvage is allowed to spawn. */
export const SPAWN = {
  x: [86, 1180],
  y: [186, 660],
  skiff: { x: 300, y: 430 },
  clearSkiff: 150,
  clearRing: 250,
};

/** Where the outer particles and screen shake live (visual only, never in the simulation). */
export const FX = { shakeBeam: 9, shakeWreck: 7, shakeDeliver: 3, maxParticles: 320 };

export const PALETTE = {
  skyTop: '#050b1a',
  skyBottom: '#0f2138',
  seaTop: '#132c50',
  seaBottom: '#081527',
  grid: 'rgba(136, 224, 240, 0.26)',
  gridBright: 'rgba(164, 255, 244, 0.44)',
  silhouette: '#061020',
  quay: '#0e1e34',
  quayEdge: '#2a4d80',
  rim: 'rgba(140, 230, 240, 0.45)',
  window: 'rgba(255, 214, 140, 0.55)',
  beam: '#a6fff5',
  beamCore: '#f2fffd',
  amber: '#ffc247',
  amberDark: '#a86d10',
  amberLit: '#fff0c2',
  coral: '#ff7a63',
  coralDark: '#8d322c',
  teal: '#6ff3e4',
  tealDim: '#49b6ae',
  ring: '#9bffe9',
  hullFull: '#7cf5b2',
  hullHalf: '#ffcf5a',
  hullLow: '#ff7a63',
  text: '#f2faff',
  muted: '#a8c2d6',
  panel: 'rgba(7, 16, 30, 0.80)',
  panelEdge: 'rgba(146, 248, 232, 0.5)',
  shadow: 'rgba(2, 6, 14, 0.45)',
};

export const FONT = {
  display: '"Segoe UI Semibold", "Segoe UI", system-ui, sans-serif',
  body: '"Segoe UI", system-ui, -apple-system, sans-serif',
  mono: 'ui-monospace, "Consolas", "SFMono-Regular", monospace',
};

/** Where the small saved settings live (localStorage only; the game never asks for anything). */
export const STORE = { best: 'tidebinder.best', motion: 'tidebinder.motion', muted: 'tidebinder.muted' };

/** Coarse frame-rate guard for the scripted pilot: how far ahead it samples a beam. */
export const PILOT = { lookAhead: 1.1, sample: 9, beamClear: 0.24, wreckClear: 96 };
