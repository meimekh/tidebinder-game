// Everything drawn over the game rather than in it: the status panels, the wave banner and the
// title, pause, victory and loss screens. It reads the world and a small `ui` record (best score,
// mute, reduced motion, input hints) and draws with the shared palette and fonts, so the HUD
// keeps its job: a player must be able to see the goal, the hull, the score, the wave and the
// delivered/target count at a glance, even shrunk into a contact sheet.

import { FONT, HULL, PALETTE, WAVES } from './config.js';

const HEIGHT = 720;

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

function panel(ctx, x, y, w, h, alpha = 0.8) {
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
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
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

export function drawHud(ctx, world, ui = {}) {
  const s = world.state;
  const width = 1280;

  // --- top left: the goal and the wave -----------------------------------------------
  panel(ctx, 16, 16, 452, 96);
  label(ctx, `WAVE ${s.wave} OF ${WAVES.length}`, 32, 40, 15, PALETTE.teal, { spacing: 3 });
  label(ctx, WAVES[s.wave - 1].name, 172, 40, 15, PALETTE.muted, { spacing: 3 });
  number(ctx, `${s.delivered} / ${s.target}`, 32, 84, 34, PALETTE.amber);
  label(ctx, 'CARGO RESCUED', 116, 76, 13, PALETTE.muted, { spacing: 2 });
  label(ctx, 'into the lighthouse ring', 116, 94, 13, PALETTE.muted);
  segmentedBar(ctx, 196, 62, 246, 22, Math.max(s.target, 1), s.delivered, PALETTE.amber, 'rgba(255,255,255,0.10)');

  // --- top right: score, chain and storm ----------------------------------------------
  panel(ctx, width - 344, 16, 328, 96);
  label(ctx, 'SCORE', width - 328, 40, 14, PALETTE.muted, { spacing: 3 });
  number(ctx, String(s.score).padStart(5, '0'), width - 328, 82, 38, PALETTE.text, { shadow: 18 });
  label(ctx, `BEST ${ui.best ?? 0}`, width - 328, 100, 13, PALETTE.muted, { spacing: 1 });
  const chainColour = s.comboTimer > 0 ? PALETTE.amberLit : PALETTE.muted;
  number(ctx, `x${s.combo}`, width - 40, 76, 30, chainColour, { align: 'right' });
  label(
    ctx,
    s.comboTimer > 0 ? `CHAIN ${s.comboTimer.toFixed(1)}s` : 'CHAIN',
    width - 40,
    98,
    13,
    chainColour,
    { align: 'right', spacing: 1 },
  );

  // --- bottom left: hull, tow weight and the dash ------------------------------------
  const hullRatio = Math.max(0, s.hull) / HULL.max;
  panel(ctx, 16, HEIGHT - 132, 396, 116);
  label(ctx, 'HULL', 32, HEIGHT - 104, 14, PALETTE.muted, { spacing: 3 });
  number(ctx, `${Math.max(0, Math.round(s.hull))} / ${HULL.max}`, 100, HEIGHT - 104, 20, hullColour(hullRatio));
  segmentedBar(ctx, 32, HEIGHT - 92, 364, 16, 10, Math.ceil(hullRatio * 10), hullColour(hullRatio), 'rgba(255,255,255,0.08)');

  const mass = s.mass.toFixed(1);
  label(ctx, `TOW  ${s.hooks} / 3 CRATES`, 32, HEIGHT - 56, 15, PALETTE.teal, { spacing: 1 });
  number(ctx, `${mass}t`, 196, HEIGHT - 56, 15, PALETTE.teal);
  label(ctx, `SPEED ${Math.round(Math.hypot(s.skiff.vx, s.skiff.vy))}`, 32, HEIGHT - 30, 14, PALETTE.muted);

  const dashReady = s.dashCd <= 0;
  const dashColour = dashReady ? PALETTE.teal : 'rgba(140,170,190,0.5)';
  label(ctx, 'DASH', 200, HEIGHT - 30, 14, dashColour, { spacing: 2 });
  const dashRatio = dashReady ? 1 : 1 - s.dashCd / 2.4;
  roundedRect(ctx, 246, HEIGHT - 40, 150, 12, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  roundedRect(ctx, 246, HEIGHT - 40, 150 * Math.max(0, dashRatio), 12, 3);
  ctx.fillStyle = dashColour;
  ctx.fill();

  // --- bottom right: what the keys do -------------------------------------------------
  const lines = [
    ['WASD / ARROWS', 'steer the skiff'],
    ['MOUSE', 'aim the helm'],
    ['SPACE / CLICK', 'tether nearest salvage'],
    ['SHIFT', 'dash through a gap'],
    ['P / ESC', 'pause ·  M mute ·  O motion'],
    ['R', 'restart a finished run'],
  ];
  let y = HEIGHT - 146;
  for (const [key, text] of lines) {
    label(ctx, key, width - 30, y, 13, PALETTE.teal, { align: 'right', spacing: 1 });
    label(ctx, text, width - 132, y, 13, PALETTE.muted, { align: 'right' });
    y += 21;
  }

  // --- wave banner --------------------------------------------------------------------
  if (s.banner) {
    const progress = Math.min(1, s.banner.timer / 2.4);
    ctx.save();
    ctx.globalAlpha = progress < 1 ? progress * 0.3 + 0.7 : 1;
    const boxW = 660;
    const x = (width - boxW) / 2;
    roundedRect(ctx, x, 206, boxW, 92, 12);
    ctx.fillStyle = 'rgba(6, 16, 32, 0.86)';
    ctx.fill();
    ctx.strokeStyle = rgba(PALETTE.ring, 0.5);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    label(ctx, s.banner.text, width / 2, 248, 28, PALETTE.ring, {
      align: 'center',
      spacing: 5,
      weight: 700,
    });
    if (s.banner.sub) label(ctx, s.banner.sub, width / 2, 278, 15, PALETTE.amber, { align: 'center', spacing: 4 });
    ctx.restore();
  }

  // --- small status flags --------------------------------------------------------------
  if (ui.muted) {
    label(ctx, 'MUTED', width - 344, 128, 13, PALETTE.coral, { spacing: 3 });
  }
  if (ui.reducedMotion) {
    label(ctx, 'REDUCED MOTION', width - 344, 148, 13, PALETTE.teal, { spacing: 2 });
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
  label(ctx, text, 640, y, size, colour, { align: 'center', spacing, weight: 800 });
}

function keyCap(ctx, x, y, w, text) {
  roundedRect(ctx, x, y, w, 24, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,220,230,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  label(ctx, text, x + w / 2, y + 17, 13, PALETTE.text, { align: 'center', spacing: 1, weight: 700 });
}

/** The whole overlay for a screen that is not live play: title, pause, victory or defeat. */
export function drawScreen(ctx, world, ui = {}) {
  const s = world.state;
  const width = 1280;

  if (s.phase === 'play') return;

  ctx.save();
  if (s.phase === 'title') {
    ctx.fillStyle = 'rgba(3, 8, 18, 0.50)';
    ctx.fillRect(0, 0, width, HEIGHT);
    roundedRect(ctx, 150, 42, 980, 636, 18);
    ctx.fillStyle = 'rgba(11, 26, 48, 0.93)';
    ctx.fill();
    ctx.strokeStyle = rgba(PALETTE.ring, 0.45);
    ctx.lineWidth = 2;
    ctx.stroke();

    titleBlock(ctx, 'T I D E B I N D E R', 134, 62, PALETTE.text, 10);
    label(ctx, 'storm salvage in the flooded clockwork harbour', 640, 170, 19, PALETTE.teal, {
      align: 'center',
      spacing: 2,
    });
    ctx.save();
    ctx.strokeStyle = rgba(PALETTE.ring, 0.5);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(300, 192);
    ctx.lineTo(980, 192);
    ctx.stroke();
    ctx.restore();

    const steps = [
      ['1', 'HOLD SPACE', 'the tether snaps onto the nearest amber crate in range'],
      ['2', 'TOW IT HOME', 'drag the crate into the lighthouse ring to rescue it'],
      ['3', 'KEEP THE CHAIN', 'deliver again within 7 seconds: x2, x3, up to x5'],
      ['4', 'SURVIVE THREE WAVES', 'storm beams scald the hull and cut your tow loose'],
    ];
    let y = 236;
    for (const [n, head, text] of steps) {
      label(ctx, n, 268, y, 22, PALETTE.amber, { align: 'center', weight: 800 });
      label(ctx, head, 306, y - 5, 18, PALETTE.text, { spacing: 2, weight: 700 });
      label(ctx, text, 306, y + 21, 16, PALETTE.muted, { family: FONT.body, weight: 400 });
      y += 66;
    }

    label(ctx, 'GOAL', 268, y - 6, 15, PALETTE.teal, { spacing: 3 });
    label(ctx, 'rescue 3 + 4 + 5 cargo across three waves and keep the hull whole', 336, y - 6, 16, PALETTE.amber, {
      family: FONT.body,
      weight: 400,
    });

    const caps = [
      ['WASD', 'steer', 70],
      ['MOUSE', 'aim', 72],
      ['SPACE', 'tether', 78],
      ['SHIFT', 'dash', 78],
      ['P', 'pause', 54],
      ['M', 'mute', 58],
      ['O', 'motion', 78],
      ['R', 'restart', 86],
    ];
    const gap = 22;
    const totalW = caps.reduce((sum, entry) => sum + entry[2], 0) + gap * (caps.length - 1);
    let capX = (width - totalW) / 2;
    const capY = 528;
    for (const [cap, text, w] of caps) {
      keyCap(ctx, capX, capY, w, cap);
      label(ctx, text, capX + w / 2, capY + 44, 12, PALETTE.muted, { align: 'center', spacing: 1 });
      capX += w + gap;
    }

    label(ctx, `BEST ${ui.best ?? 0}`, 296, 602, 18, PALETTE.amber, { spacing: 2 });
    label(ctx, ui.muted ? 'MUTED' : 'SOUND ON', 640, 602, 15, ui.muted ? PALETTE.coral : PALETTE.teal, {
      align: 'center',
      spacing: 2,
    });
    label(
      ctx,
      ui.reducedMotion ? 'REDUCED MOTION' : 'FULL MOTION',
      984,
      602,
      15,
      ui.reducedMotion ? PALETTE.teal : PALETTE.muted,
      { align: 'right', spacing: 2 },
    );

    const pulse = ui.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin((ui.time ?? 0) * 2.6);
    label(ctx, 'PRESS ENTER OR CLICK TO BEGIN', 640, 650, 23, PALETTE.ring, {
      align: 'center',
      spacing: 6,
      weight: 800,
    });
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, pulse)) * 0.75;
    label(ctx, 'PRESS ENTER OR CLICK TO BEGIN', 640, 650, 23, PALETTE.beam, {
      align: 'center',
      spacing: 6,
      weight: 800,
    });
    ctx.restore();
  }

  if (s.phase === 'paused') {
    ctx.fillStyle = 'rgba(3, 8, 18, 0.6)';
    ctx.fillRect(0, 0, width, HEIGHT);
    roundedRect(ctx, 396, 236, 488, 232, 16);
    ctx.fillStyle = 'rgba(11, 26, 48, 0.94)';
    ctx.fill();
    ctx.strokeStyle = rgba(PALETTE.teal, 0.5);
    ctx.lineWidth = 2;
    ctx.stroke();
    titleBlock(ctx, 'PAUSED', 306, 46, PALETTE.teal, 8);
    label(ctx, 'the storm keeps turning, the crates keep drifting', 640, 344, 17, PALETTE.muted, {
      align: 'center',
      family: FONT.body,
    });
    label(ctx, 'P / ESC  resume', 640, 400, 18, PALETTE.text, { align: 'center', spacing: 2 });
    label(ctx, 'M  mute ·  O  reduced motion ·  R  restart', 640, 434, 16, PALETTE.muted, {
      align: 'center',
      family: FONT.body,
    });
  }

  if (s.phase === 'win' || s.phase === 'lose') {
    const won = s.phase === 'win';
    ctx.fillStyle = won ? 'rgba(3, 14, 24, 0.5)' : 'rgba(20, 5, 8, 0.55)';
    ctx.fillRect(0, 0, width, HEIGHT);
    roundedRect(ctx, 300, 118, 680, 500, 18);
    ctx.fillStyle = 'rgba(11, 26, 48, 0.94)';
    ctx.fill();
    ctx.strokeStyle = won ? rgba(PALETTE.ring, 0.6) : rgba(PALETTE.coral, 0.6);
    ctx.lineWidth = 2;
    ctx.stroke();

    titleBlock(ctx, won ? 'SALVAGE COMPLETE' : 'HULL BREACHED', 198, 44, won ? PALETTE.ring : PALETTE.coral, 6);
    label(
      ctx,
      won ? 'the lighthouse holds the harbour. the storm moves on.' : 'the storm took your skiff. the crates drift on.',
      640,
      234,
      18,
      PALETTE.muted,
      { align: 'center', family: FONT.body },
    );

    const rows = [
      ['FINAL SCORE', String(s.score)],
      ['CARGO RESCUED', `${s.totalDelivered} / 12`],
      ['WAVES CLEARED', `${s.cleared} / 3`],
      ['HITS TAKEN', String(s.hits)],
      ['DASHES USED', String(s.dashes)],
    ];
    let y = 302;
    for (const [head, value] of rows) {
      label(ctx, head, 372, y, 15, PALETTE.muted, { spacing: 3 });
      number(ctx, value, 908, y, 24, head === 'FINAL SCORE' ? (won ? PALETTE.amberLit : PALETTE.text) : PALETTE.text, {
        align: 'right',
      });
      y += 46;
    }

    if (won && s.score > (ui.previousBest ?? 0)) {
      label(ctx, 'NEW BEST SCORE', 640, y + 4, 18, PALETTE.amberLit, { align: 'center', spacing: 5, weight: 800 });
    } else if (won) {
      label(ctx, `PERSONAL BEST ${ui.best ?? 0}`, 640, y + 4, 16, PALETTE.amber, { align: 'center', spacing: 3 });
    } else {
      label(ctx, `PERSONAL BEST ${ui.best ?? 0}`, 640, y + 4, 16, PALETTE.muted, { align: 'center', spacing: 3 });
    }

    const pulse = ui.reducedMotion ? 1 : 0.6 + 0.4 * Math.sin((ui.time ?? 0) * 2.6);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, pulse)) * 0.85;
    label(ctx, 'PRESS R OR ENTER TO SAIL AGAIN', 640, 566, 21, PALETTE.text, {
      align: 'center',
      spacing: 5,
      weight: 800,
    });
    ctx.restore();
    label(ctx, 'ESC returns to the title', 640, 594, 15, PALETTE.muted, { align: 'center', family: FONT.body });
  }

  ctx.restore();
}
