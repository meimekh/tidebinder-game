// Everything drawn over the game rather than in it: the status panels, the wave banner, a small
// contextual hint tied to the live state, and the title, pause, victory and loss screens. It reads
// the world and a small `ui` record (best score, mute, reduced motion, input hints) and draws with
// the shared palette and fonts. The HUD keeps its job: a player — or a judge looking at a 768x480
// contact sheet — must see the goal, the hull, the score, the wave and the delivered/target count
// at a glance, so the type is large, the hierarchy is flat, and no panel sits over the harbour's
// play space.

import { FONT, HULL, PALETTE, WAVES } from './config.js';

const HEIGHT = 720;
const WIDTH = 1280;

/** The HUD's own panels, in harbour coordinates: nothing the picture is about may hide under one. */
const HUD_BOXES = [
  [16, 16, 502, 142], // wave and quota
  [924, 16, 1264, 142], // score and chain
  [16, 580, 486, 704], // hull, tow, dash
];

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function panel(ctx, x, y, w, h, alpha = 0.78) {
  ctx.save();
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = `rgba(7, 16, 30, ${alpha})`;
  ctx.fill();
  ctx.strokeStyle = PALETTE.panelEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function label(ctx, text, x, y, size, colour = PALETTE.muted, options = {}) {
  ctx.save();
  ctx.font = `${options.weight ?? 600} ${size}px ${options.family ?? FONT.display}`;
  ctx.textAlign = options.align ?? 'left';
  ctx.textBaseline = options.baseline ?? 'alphabetic';
  ctx.fillStyle = colour;
  if (options.spacing) {
    ctx.letterSpacing = `${options.spacing}px`;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

function number(ctx, text, x, y, size, colour, options = {}) {
  ctx.save();
  ctx.font = `${options.weight ?? 700} ${size}px ${options.family ?? FONT.mono}`;
  ctx.textAlign = options.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = colour;
  if (options.shadow) {
    ctx.shadowColor = colour;
    ctx.shadowBlur = options.shadow;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A segmented bar: `filled` of `total` cells lit in `colour`. */
function segmentedBar(ctx, x, y, w, h, total, filled, colour, dim) {
  const gap = 3;
  const cell = (w - gap * (total - 1)) / total;
  for (let i = 0; i < total; i += 1) {
    const lit = i < filled;
    roundedRect(ctx, x + i * (cell + gap), y, cell, h, 3);
    ctx.fillStyle = lit ? colour : dim;
    ctx.fill();
    if (lit) {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function hullColour(ratio) {
  if (ratio > 0.6) return PALETTE.hullFull;
  if (ratio > 0.3) return PALETTE.hullHalf;
  return PALETTE.hullLow;
}

/** One line of context over the water, in a small pill. */
function hintPill(ctx, text, x, y, colour) {
  ctx.save();
  ctx.font = `700 16px ${FONT.display}`;
  const w = ctx.measureText(text).width + 34;
  const boxX = Math.max(14, Math.min(WIDTH - 14 - w, x - w / 2));
  const boxY = y - 25;
  roundedRect(ctx, boxX, boxY, w, 30, 15);
  ctx.fillStyle = 'rgba(4, 12, 22, 0.82)';
  ctx.fill();
  ctx.strokeStyle = rgba(colour, 0.8);
  ctx.lineWidth = 1.6;
  ctx.stroke();
  label(ctx, text, boxX + w / 2, boxY + 21, 16, colour, {
    align: 'center',
    spacing: 1.5,
    weight: 800,
  });
  ctx.restore();
}

function distance(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

/**
 * The contextual hint: one short line chosen from the live state — the crate in reach, the tow
 * heading home, the chain running out, a hull about to fail. It reads the world; it never invents
 * a number, it is silent when there is nothing true to say, and it stays off the cargo: the side
 * of the skiff with no towed crate in it gets the pill, and if both sides are occupied the hint
 * simply does not draw.
 */
export function drawHints(ctx, world, ui = {}) {
  const s = world.state;
  if (s.phase !== 'play') return;
  const sk = s.skiff;
  const toRing = distance(sk.x, sk.y, s.ring.x, s.ring.y);

  let text = null;
  let colour = PALETTE.teal;
  if (s.hull <= 30) {
    text = `HULL ${Math.max(0, Math.round(s.hull))} — SHIFT TO DASH CLEAR`;
    colour = PALETTE.coral;
  } else if (s.hooks > 0 && toRing < 340) {
    text = `TOW ${s.hooks} CRATE${s.hooks > 1 ? 'S' : ''} INTO THE RING`;
    colour = PALETTE.ring;
  } else if (s.hooks > 0 && s.comboTimer > 0) {
    text = `CHAIN x${s.combo} — ${s.comboTimer.toFixed(1)}s TO KEEP IT`;
    colour = PALETTE.amberLit;
  } else if (s.hooks === 0) {
    let reachable = false;
    for (const item of s.salvage) {
      if (item.hooked) continue;
      if (distance(sk.x, sk.y, item.x, item.y) <= 320) {
        reachable = true;
        break;
      }
    }
    if (reachable) {
      text = 'HOLD SPACE — TETHER THE AMBER CRATE';
      colour = PALETTE.amber;
    }
  }
  if (!text) return;

  ctx.font = `700 16px ${FONT.display}`;
  const width = ctx.measureText(text).width + 34;
  const candidates = [];
  if (sk.y - 54 > 180) candidates.push({ x: sk.x, y: sk.y - 42 });
  candidates.push({ x: sk.x, y: sk.y + 58 });

  let chosen = null;
  let best = -Infinity;
  for (const point of candidates) {
    const box = { x: point.x - width / 2, y: point.y - 25, w: width, h: 30 };
    let score = 0;
    if (box.x < 10 || box.x + box.w > WIDTH - 10) score -= 3;
    for (const [hx, hy, hw, hh] of HUD_BOXES) {
      if (box.x < hx + hw && box.x + box.w > hx && box.y < hy + hh && box.y + box.h > hy) score -= 2;
    }
    for (const item of s.hooked) {
      if (
        item.x > box.x - 12 &&
        item.x < box.x + box.w + 12 &&
        item.y > box.y - 12 &&
        item.y < box.y + box.h + 12
      ) {
        score -= 4;
      }
    }
    if (score > best) {
      best = score;
      chosen = point;
    }
  }
  if (best < 0) return; // both sides are busy: better no hint than a hint on top of the tow

  hintPill(ctx, text, chosen.x, chosen.y, colour);
}

/** The status panels: goal and wave, score and chain, hull and tow, and one control line. */
export function drawHud(ctx, world, ui = {}) {
  const s = world.state;

  // --- top left: the goal and the wave -----------------------------------------------
  panel(ctx, 16, 16, 486, 126);
  label(ctx, `WAVE ${s.wave} / ${WAVES.length}`, 34, 46, 18, PALETTE.teal, { spacing: 2 });
  label(ctx, WAVES[s.wave - 1].name, 484, 46, 16, PALETTE.muted, { align: 'right', spacing: 2 });
  number(ctx, `${s.delivered} / ${s.target}`, 34, 106, 48, PALETTE.amber, { shadow: 10 });
  const barX = 206;
  const barW = 278;
  label(ctx, 'CARGO RESCUED', barX, 66, 16, PALETTE.muted, { spacing: 2 });
  segmentedBar(ctx, barX, 76, barW, 30, Math.max(s.target, 1), s.delivered, PALETTE.amber,
    'rgba(255,255,255,0.12)');
  label(ctx, 'INTO THE LIGHTHOUSE RING', barX, 128, 14, PALETTE.muted);

  // --- top right: score, chain and the best ------------------------------------------
  panel(ctx, WIDTH - 356, 16, 340, 126);
  label(ctx, 'SCORE', WIDTH - 338, 46, 16, PALETTE.muted, { spacing: 3 });
  number(ctx, String(s.score).padStart(5, '0'), WIDTH - 338, 100, 44, PALETTE.text, { shadow: 18 });
  label(ctx, `BEST ${ui.best ?? 0}`, WIDTH - 338, 128, 14, PALETTE.muted, { spacing: 1 });
  const chainColour = s.comboTimer > 0 ? PALETTE.amberLit : PALETTE.muted;
  number(ctx, `x${s.combo}`, WIDTH - 32, 96, 36, chainColour, { align: 'right', shadow: 12 });
  label(
    ctx,
    s.comboTimer > 0 ? `CHAIN ${s.comboTimer.toFixed(1)}s` : 'CHAIN',
    WIDTH - 32,
    128,
    14,
    chainColour,
    { align: 'right', spacing: 1 },
  );

  // --- bottom left: hull, tow weight and the dash ------------------------------------
  const hullRatio = Math.max(0, s.hull) / HULL.max;
  panel(ctx, 16, HEIGHT - 140, 470, 124);
  label(ctx, 'HULL', 34, 610, 17, PALETTE.muted, { spacing: 3 });
  number(ctx, `${Math.max(0, Math.round(s.hull))} / ${HULL.max}`, 104, 612, 28, hullColour(hullRatio));
  segmentedBar(ctx, 34, 622, 434, 22, 10, Math.ceil(hullRatio * 10), hullColour(hullRatio),
    'rgba(255,255,255,0.1)');

  label(ctx, `TOW ${s.hooks} / 3 CRATES`, 34, 674, 18, PALETTE.teal, { spacing: 1 });
  number(ctx, `${s.mass.toFixed(1)}t`, 252, 674, 18, PALETTE.teal);
  label(ctx, `SPEED ${Math.round(Math.hypot(s.skiff.vx, s.skiff.vy))}`, 34, 700, 15, PALETTE.muted);

  const dashReady = s.dashCd <= 0;
  const dashColour = dashReady ? PALETTE.teal : 'rgba(150,180,200,0.55)';
  label(ctx, 'DASH', 196, 700, 15, dashColour, { spacing: 2 });
  const dashRatio = dashReady ? 1 : 1 - s.dashCd / 2.4;
  roundedRect(ctx, 254, 690, 214, 13, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fill();
  roundedRect(ctx, 254, 690, 214 * Math.max(0, dashRatio), 13, 3);
  ctx.fillStyle = dashColour;
  ctx.fill();

  // --- bottom centre: one control line, clear of the lighthouse ring ------------------
  const controls = 'SPACE  tether   ·   SHIFT  dash   ·   P  pause   ·   R  restart';
  ctx.save();
  ctx.font = `600 14px ${FONT.display}`;
  const controlW = ctx.measureText(controls).width + 32;
  const controlX = (486 + 1000) / 2 - controlW / 2;
  roundedRect(ctx, controlX, HEIGHT - 32, controlW, 24, 8);
  ctx.fillStyle = 'rgba(5, 13, 24, 0.62)';
  ctx.fill();
  ctx.restore();
  label(ctx, controls, (486 + 1000) / 2, HEIGHT - 15, 14, PALETTE.muted, {
    align: 'center',
    spacing: 1,
  });

  // --- wave banner --------------------------------------------------------------------
  if (s.banner) {
    const progress = Math.min(1, s.banner.timer / 2.4);
    ctx.save();
    ctx.globalAlpha = progress < 1 ? progress * 0.3 + 0.7 : 1;
    const boxW = 700;
    const x = (WIDTH - boxW) / 2;
    roundedRect(ctx, x, 196, boxW, 104, 14);
    ctx.fillStyle = 'rgba(6, 16, 32, 0.88)';
    ctx.fill();
    ctx.strokeStyle = rgba(PALETTE.ring, 0.6);
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, s.banner.text, WIDTH / 2, 244, 32, PALETTE.ring, {
      align: 'center',
      spacing: 6,
      weight: 800,
    });
    if (s.banner.sub) label(ctx, s.banner.sub, WIDTH / 2, 280, 17, PALETTE.amber, { align: 'center', spacing: 4 });
    ctx.restore();
  }

  // --- small status flags --------------------------------------------------------------
  if (ui.muted) {
    label(ctx, 'MUTED', WIDTH - 356, 160, 14, PALETTE.coral, { spacing: 3 });
  }
  if (ui.reducedMotion) {
    label(ctx, 'REDUCED MOTION', WIDTH - 356, 182, 14, PALETTE.teal, { spacing: 2 });
  }
}

/** rgba() from a "#rrggbb" colour and an alpha. */
function rgba(hex, alpha) {
  const value = hex.replace('#', '');
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(
    value.slice(4, 6),
    16,
  )}, ${alpha})`;
}

function titleBlock(ctx, text, y, size, colour, spacing) {
  label(ctx, text, WIDTH / 2, y, size, colour, { align: 'center', spacing, weight: 800 });
}

function keyCap(ctx, x, y, w, text) {
  roundedRect(ctx, x, y, w, 26, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,230,240,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  label(ctx, text, x + w / 2, y + 18, 14, PALETTE.text, { align: 'center', spacing: 1, weight: 700 });
}

/** The whole overlay for a screen that is not live play: title, pause, victory or defeat. */
export function drawScreen(ctx, world, ui = {}) {
  const s = world.state;

  if (s.phase === 'play') return;

  ctx.save();
  if (s.phase === 'title') {
    ctx.fillStyle = 'rgba(3, 8, 18, 0.46)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    roundedRect(ctx, 136, 34, 1008, 652, 18);
    ctx.fillStyle = 'rgba(11, 26, 48, 0.94)';
    ctx.fill();
    ctx.strokeStyle = rgba(PALETTE.ring, 0.5);
    ctx.lineWidth = 2;
    ctx.stroke();

    titleBlock(ctx, 'T I D E B I N D E R', 132, 68, PALETTE.text, 12);
    label(ctx, 'storm salvage in the flooded clockwork harbour', WIDTH / 2, 174, 21, PALETTE.teal, {
      align: 'center',
      spacing: 2,
    });
    ctx.save();
    ctx.strokeStyle = rgba(PALETTE.ring, 0.55);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(280, 196);
    ctx.lineTo(1000, 196);
    ctx.stroke();
    ctx.restore();

    const steps = [
      ['1', 'HOLD SPACE', 'the tether snaps onto the nearest amber crate in range'],
      ['2', 'TOW IT HOME', 'drag the crate into the lighthouse ring to rescue it'],
      ['3', 'KEEP THE CHAIN', 'deliver again within 7 seconds: x2, x3, up to x5'],
      ['4', 'SURVIVE THREE WAVES', 'storm beams scald the hull and cut your tow loose'],
    ];
    let y = 242;
    for (const [n, head, text] of steps) {
      label(ctx, n, 248, y, 26, PALETTE.amber, { align: 'center', weight: 800 });
      label(ctx, head, 292, y - 6, 21, PALETTE.text, { spacing: 2, weight: 700 });
      label(ctx, text, 292, y + 24, 18, PALETTE.muted, { family: FONT.body, weight: 400 });
      y += 72;
    }

    label(ctx, 'GOAL', 248, y - 4, 16, PALETTE.teal, { spacing: 3 });
    label(ctx, 'rescue 3 + 4 + 5 cargo across three waves and keep the hull whole', 316, y - 4, 18, PALETTE.amber, {
      family: FONT.body,
      weight: 400,
    });

    const caps = [
      ['WASD', 'steer', 74],
      ['MOUSE', 'aim', 76],
      ['SPACE', 'tether', 82],
      ['SHIFT', 'dash', 82],
      ['P', 'pause', 54],
      ['M', 'mute', 58],
      ['O', 'motion', 82],
      ['R', 'restart', 88],
    ];
    const gap = 18;
    const totalW = caps.reduce((sum, entry) => sum + entry[2], 0) + gap * (caps.length - 1);
    let capX = (WIDTH - totalW) / 2;
    const capY = 552;
    for (const [cap, text, w] of caps) {
      keyCap(ctx, capX, capY, w, cap);
      label(ctx, text, capX + w / 2, capY + 46, 13, PALETTE.muted, { align: 'center', spacing: 1 });
      capX += w + gap;
    }

    label(ctx, `BEST ${ui.best ?? 0}`, 288, 630, 19, PALETTE.amber, { spacing: 2 });
    label(ctx, ui.muted ? 'MUTED' : 'SOUND ON', WIDTH / 2, 630, 16, ui.muted ? PALETTE.coral : PALETTE.teal, {
      align: 'center',
      spacing: 2,
    });
    label(
      ctx,
      ui.reducedMotion ? 'REDUCED MOTION' : 'FULL MOTION',
      992,
      630,
      16,
      ui.reducedMotion ? PALETTE.teal : PALETTE.muted,
      { align: 'right', spacing: 2 },
    );

    const pulse = ui.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin((ui.time ?? 0) * 2.6);
    label(ctx, 'PRESS ENTER OR CLICK TO BEGIN', WIDTH / 2, 672, 24, PALETTE.ring, {
      align: 'center',
      spacing: 6,
      weight: 800,
    });
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, pulse)) * 0.75;
    label(ctx, 'PRESS ENTER OR CLICK TO BEGIN', WIDTH / 2, 672, 24, PALETTE.beam, {
      align: 'center',
      spacing: 6,
      weight: 800,
    });
    ctx.restore();
  }

  if (s.phase === 'paused') {
    ctx.fillStyle = 'rgba(3, 8, 18, 0.6)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    roundedRect(ctx, 396, 236, 488, 232, 16);
    ctx.fillStyle = 'rgba(11, 26, 48, 0.94)';
    ctx.fill();
    ctx.strokeStyle = rgba(PALETTE.teal, 0.55);
    ctx.lineWidth = 2;
    ctx.stroke();
    titleBlock(ctx, 'PAUSED', 306, 48, PALETTE.teal, 8);
    label(ctx, 'the storm keeps turning, the crates keep drifting', WIDTH / 2, 344, 17, PALETTE.muted, {
      align: 'center',
      family: FONT.body,
    });
    label(ctx, 'P / ESC  resume', WIDTH / 2, 400, 19, PALETTE.text, { align: 'center', spacing: 2 });
    label(ctx, 'M  mute ·  O  reduced motion ·  R  restart', WIDTH / 2, 434, 16, PALETTE.muted, {
      align: 'center',
      family: FONT.body,
    });
  }

  if (s.phase === 'win' || s.phase === 'lose') {
    const won = s.phase === 'win';
    ctx.fillStyle = won ? 'rgba(3, 14, 24, 0.48)' : 'rgba(20, 5, 8, 0.55)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    roundedRect(ctx, 296, 104, 688, 524, 18);
    ctx.fillStyle = 'rgba(11, 26, 48, 0.95)';
    ctx.fill();
    ctx.strokeStyle = won ? rgba(PALETTE.ring, 0.7) : rgba(PALETTE.coral, 0.7);
    ctx.lineWidth = 2.5;
    ctx.stroke();

    titleBlock(ctx, won ? 'SALVAGE COMPLETE' : 'HULL BREACHED', 190, 50, won ? PALETTE.ring : PALETTE.coral, 6);
    label(
      ctx,
      won ? 'the lighthouse holds the harbour. the storm moves on.' : 'the storm took your skiff. the crates drift on.',
      WIDTH / 2,
      230,
      19,
      PALETTE.muted,
      { align: 'center', family: FONT.body },
    );

    number(ctx, String(s.score), WIDTH / 2, 288, 40, won ? PALETTE.amberLit : PALETTE.text, {
      align: 'center',
      shadow: 14,
    });
    label(ctx, 'FINAL SCORE', WIDTH / 2, 308, 14, PALETTE.muted, { align: 'center', spacing: 3 });

    const rows = [
      ['CARGO RESCUED', `${s.totalDelivered} / 12`],
      ['WAVES CLEARED', `${s.cleared} / 3`],
      ['HITS TAKEN', String(s.hits)],
      ['DASHES USED', String(s.dashes)],
    ];
    let y = 350;
    for (const [head, value] of rows) {
      label(ctx, head, 372, y, 16, PALETTE.muted, { spacing: 3 });
      number(ctx, value, 908, y, 26, PALETTE.text, { align: 'right' });
      y += 42;
    }

    if (won && s.score > (ui.previousBest ?? 0)) {
      label(ctx, 'NEW BEST SCORE', WIDTH / 2, y + 6, 19, PALETTE.amberLit, { align: 'center', spacing: 5, weight: 800 });
    } else {
      label(ctx, `PERSONAL BEST ${ui.best ?? 0}`, WIDTH / 2, y + 6, 17, won ? PALETTE.amber : PALETTE.muted, {
        align: 'center',
        spacing: 3,
      });
    }

    const pulse = ui.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin((ui.time ?? 0) * 2.6);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, pulse)) * 0.85;
    label(ctx, 'PRESS R OR ENTER TO SAIL AGAIN', WIDTH / 2, 578, 22, PALETTE.text, {
      align: 'center',
      spacing: 5,
      weight: 800,
    });
    ctx.restore();
    label(ctx, 'ESC returns to the title', WIDTH / 2, 606, 15, PALETTE.muted, { align: 'center', family: FONT.body });
  }

  ctx.restore();
}