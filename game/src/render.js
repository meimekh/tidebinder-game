// The harbour as the player sees it. This module draws only: it reads the world, never changes
// it. Everything is vector art on a 2D canvas — an isometric tile sea, quay silhouettes, gear
// towers, storm beams, amber salvage, coral wrecks and the skiff — in the midnight-navy and pale
// teal palette from config.js. The particle layer and the screen shake live here too, because they
// are pictures, not rules.

import { BEAM, FIELD, PALETTE, SKIFF, WATER } from './config.js';
import { beamHitsBeam } from './simulation.js';

const TAU = Math.PI * 2;

/** "rgba(...)" from a "#rrggbb" colour and an alpha, for the many translucent washes. */
function rgba(hex, alpha) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A 2:1 isometric cube: a diamond top face lifted by `height`, with the two front faces below it.
 * This one helper is what makes the salvage, the wrecks and the clockwork towers read as solid.
 */
function isoCube(ctx, x, y, width, height, colours) {
  const halfW = width / 2;
  const halfD = width / 4;
  const top = rgba(colours.top, colours.alpha ?? 1);
  const left = rgba(colours.left, colours.alpha ?? 1);
  const right = rgba(colours.right, colours.alpha ?? 1);

  ctx.beginPath();
  ctx.moveTo(x, y - height - halfD);
  ctx.lineTo(x + halfW, y - height);
  ctx.lineTo(x, y - height + halfD);
  ctx.lineTo(x - halfW, y - height);
  ctx.closePath();
  ctx.fillStyle = top;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x - halfW, y - height);
  ctx.lineTo(x, y - height + halfD);
  ctx.lineTo(x, y + halfD);
  ctx.lineTo(x - halfW, y);
  ctx.closePath();
  ctx.fillStyle = left;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + halfW, y - height);
  ctx.lineTo(x, y - height + halfD);
  ctx.lineTo(x, y + halfD);
  ctx.lineTo(x + halfW, y);
  ctx.closePath();
  ctx.fillStyle = right;
  ctx.fill();
}

/** A soft ellipse of water shadow under a floating thing. */
function waterShadow(ctx, x, y, rx, ry, alpha = 0.45) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = rgba('#02060e', alpha);
  ctx.fill();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const particles = [];
  const seen = new WeakSet();
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let viewW = FIELD.width;
  let viewH = FIELD.height;
  let shakeAmount = 0;
  let shakeSeed = 0;

  /** Add one particle; the layer is capped so a long game can never bloat it. */
  function emit(particle) {
    if (particles.length >= 320) particles.shift();
    particles.push({
      x: particle.x,
      y: particle.y,
      vx: particle.vx ?? 0,
      vy: particle.vy ?? 0,
      life: particle.life ?? 1,
      maxLife: particle.life ?? 1,
      size: particle.size ?? 3,
      colour: particle.colour ?? PALETTE.teal,
      drag: particle.drag ?? 1.6,
      glow: particle.glow ?? false,
    });
  }

  function burst(x, y, count, options) {
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * TAU + (options.spread ?? 0) + i * 0.37;
      const speed = (options.speed ?? 90) * (0.45 + ((i * 7) % 11) / 11);
      emit({
        x: x + Math.cos(angle) * (options.radius ?? 6),
        y: y + Math.sin(angle) * (options.radius ?? 6),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: (options.life ?? 0.7) * (0.6 + ((i * 5) % 9) / 9),
        size: (options.size ?? 3) * (0.6 + ((i * 3) % 7) / 7),
        colour: options.colour ?? PALETTE.teal,
        glow: options.glow ?? true,
      });
    }
  }

  /** Turn the events the simulation made into pictures, once each. */
  function ingest(world) {
    for (const event of world.fx) {
      if (seen.has(event)) continue;
      seen.add(event);
      switch (event.type) {
        case 'attach':
          burst(event.x, event.y, 8, { colour: PALETTE.teal, speed: 70, life: 0.5, size: 2.4 });
          break;
        case 'release':
          burst(event.x, event.y, 5, { colour: PALETTE.tealDim, speed: 40, life: 0.4, size: 2 });
          break;
        case 'snap':
        case 'cut':
          burst(event.x, event.y, 12, { colour: PALETTE.coral, speed: 130, life: 0.6, size: 2.6 });
          break;
        case 'deliver':
          burst(event.x, event.y, 22, { colour: PALETTE.amberLit, speed: 150, life: 0.9, size: 3.4 });
          burst(event.x, event.y, 14, { colour: PALETTE.teal, speed: 210, life: 0.7, size: 2.6 });
          break;
        case 'beamHit':
          burst(event.x, event.y, 20, { colour: PALETTE.beam, speed: 190, life: 0.7, size: 3 });
          break;
        case 'wreckHit':
          burst(event.x, event.y, 16, { colour: PALETTE.coral, speed: 160, life: 0.6, size: 3 });
          break;
        case 'dash':
          burst(event.x, event.y, 18, {
            colour: PALETTE.teal,
            speed: 120,
            life: 0.55,
            size: 2.8,
            spread: event.angle + Math.PI,
          });
          break;
        case 'waveStart':
          burst(event.x, event.y, 26, { colour: PALETTE.ring, speed: 120, life: 1.1, size: 3 });
          break;
        case 'waveClear':
          burst(event.x, event.y, 30, { colour: PALETTE.ring, speed: 150, life: 1.3, size: 3.4 });
          break;
        case 'win':
          burst(event.x, event.y, 46, { colour: PALETTE.amberLit, speed: 210, life: 1.6, size: 4 });
          burst(event.x, event.y, 30, { colour: PALETTE.ring, speed: 260, life: 1.4, size: 3 });
          break;
        case 'lose':
          burst(event.x, event.y, 34, { colour: PALETTE.coral, speed: 180, life: 1.4, size: 4 });
          break;
        default:
          break;
      }
    }
  }

  function stepParticles(dt, reducedMotion) {
    const factor = reducedMotion ? 0.55 : 1;
    const keep = [];
    for (const p of particles) {
      p.life -= dt * factor;
      if (p.life <= 0) continue;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      keep.push(p);
    }
    particles.length = 0;
    for (const p of keep) particles.push(p);
  }

  function drawParticles(reducedMotion) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = reducedMotion ? alpha * 0.6 : alpha;
      ctx.fillStyle = p.colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + alpha * 0.8), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The sky band, the quay wall, warehouses, gantries and the two great clockwork gears. */
  function drawHarbourBackdrop(time, reducedMotion) {
    const horizon = WATER.y0;

    // The water: the sea gradient starts at the waterline, so the sky stays sky.
    const sea = ctx.createLinearGradient(0, horizon - 48, 0, FIELD.height + 220);
    sea.addColorStop(0, PALETTE.seaTop);
    sea.addColorStop(1, PALETTE.seaBottom);
    ctx.fillStyle = sea;
    ctx.fillRect(-260, horizon - 48, FIELD.width + 520, FIELD.height - horizon + 508);

    // A scatter of cold stars over the quay: placed by index, so a screenshot repeats exactly.
    ctx.fillStyle = '#dff8f4';
    for (let i = 0; i < 54; i += 1) {
      const sx = 24 + ((i * 97) % 1240);
      const sy = 5 + ((i * 53) % 52);
      ctx.globalAlpha = 0.3 + ((i * 29) % 50) / 120;
      ctx.fillRect(sx, sy, i % 7 === 0 ? 1.8 : 1.2, i % 7 === 0 ? 1.8 : 1.2);
    }
    ctx.globalAlpha = 1;

    // The storm moon and its halo.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(1006, 78, 4, 1006, 78, 190);
    halo.addColorStop(0, rgba(PALETTE.beam, 0.40));
    halo.addColorStop(0.4, rgba(PALETTE.teal, 0.15));
    halo.addColorStop(1, rgba(PALETTE.teal, 0));
    ctx.fillStyle = halo;
    ctx.fillRect(790, -120, 440, 420);
    ctx.beginPath();
    ctx.arc(1006, 78, 26, 0, TAU);
    ctx.fillStyle = rgba('#dff8f4', 0.85);
    ctx.fill();
    ctx.restore();

    // Gantry cranes: bare triangles and braces along the quay.
    ctx.strokeStyle = rgba(PALETTE.quayEdge, 0.9);
    ctx.lineWidth = 3;
    const cranes = [
      [232, 118, 64],
      [520, 118, 92],
      [806, 118, 58],
    ];
    for (const [x, base, height] of cranes) {
      ctx.beginPath();
      ctx.moveTo(x - 34, base);
      ctx.lineTo(x - 10, base - height);
      ctx.lineTo(x + 26, base - height);
      ctx.lineTo(x + 46, base);
      ctx.moveTo(x - 12, base - height * 0.55);
      ctx.lineTo(x + 30, base - height * 0.55);
      ctx.moveTo(x - 10, base - height);
      ctx.lineTo(x + 46, base);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 10, base - height);
      ctx.lineTo(x + 92, base - height + 10);
      ctx.stroke();
    }

    // Warehouses and their lit windows.
    const blocks = [
      [40, 118, 150, 74],
      [206, 118, 74, 52],
      [300, 118, 190, 88],
      [612, 118, 120, 60],
      [700, 118, 158, 96],
      [880, 118, 96, 66],
      [1090, 118, 170, 78],
    ];
    for (const [x, base, w, h] of blocks) {
      ctx.fillStyle = PALETTE.silhouette;
      ctx.fillRect(x, base - h, w, h);
      ctx.fillStyle = rgba(PALETTE.quayEdge, 0.9);
      ctx.fillRect(x, base - h, w, 3);
      ctx.fillStyle = PALETTE.rim;
      ctx.fillRect(x, base - h, w, 1);
    }
    if (!reducedMotion) {
      for (let i = 0; i < 22; i += 1) {
        const bx = 48 + i * 55;
        const by = 118 - 26 - ((i * 13) % 40);
        if (bx > 1250) break;
        const flicker = 0.4 + 0.35 * Math.sin(time * 2.1 + i * 1.7);
        ctx.fillStyle = rgba(PALETTE.amber, 0.18 + flicker * 0.3);
        ctx.fillRect(bx, by, 5, 7);
      }
    } else {
      ctx.fillStyle = rgba(PALETTE.amber, 0.35);
      for (let i = 0; i < 22; i += 1) {
        const bx = 48 + i * 55;
        const by = 118 - 26 - ((i * 13) % 40);
        if (bx > 1250) break;
        ctx.fillRect(bx, by, 5, 7);
      }
    }

    // Two great clockwork gears, half in the water: the harbour that never quite stopped.
    const gears = [
      [104, 120, 62, 11, 0.06],
      [1198, 114, 88, 15, -0.04],
    ];
    for (const [gx, gy, radius, teeth, spin] of gears) {
      ctx.save();
      ctx.translate(gx, gy);
      ctx.rotate(time * spin);
      ctx.fillStyle = rgba('#0d1b30', 0.95);
      ctx.beginPath();
      for (let i = 0; i < teeth; i += 1) {
        const a0 = (i / teeth) * TAU;
        const a1 = ((i + 0.5) / teeth) * TAU;
        const a2 = ((i + 1) / teeth) * TAU;
        ctx.lineTo(Math.cos(a0) * radius, Math.sin(a0) * radius * 0.55);
        ctx.lineTo(Math.cos(a1) * radius * 1.14, Math.sin(a1) * radius * 0.63);
        ctx.lineTo(Math.cos(a2) * radius, Math.sin(a2) * radius * 0.55);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(PALETTE.teal, 0.28);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 0.3, radius * 0.17, 0, 0, TAU);
      ctx.fillStyle = rgba(PALETTE.teal, 0.20);
      ctx.fill();
      ctx.restore();
    }

    // The quay wall: a dark band with a lit lip and its smeared reflection.
    ctx.fillStyle = PALETTE.quay;
    ctx.fillRect(-260, horizon - 46, FIELD.width + 520, 46);
    ctx.fillStyle = rgba(PALETTE.quayEdge, 0.85);
    ctx.fillRect(-260, horizon - 46, FIELD.width + 520, 3);
    const reflection = ctx.createLinearGradient(0, horizon, 0, horizon + 74);
    reflection.addColorStop(0, rgba(PALETTE.quayEdge, 0.30));
    reflection.addColorStop(1, rgba(PALETTE.quayEdge, 0));
    ctx.fillStyle = reflection;
    ctx.fillRect(-260, horizon, FIELD.width + 520, 74);
  }

  /** The isometric tile sea: two families of diagonals, drifting slowly. */
  function drawSeaGrid(time, reducedMotion) {
    const spacing = 84;
    const drift = reducedMotion ? 0 : (time * 6) % spacing;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-260, WATER.y0, FIELD.width + 520, FIELD.height - WATER.y0 + 460);
    ctx.clip();
    ctx.lineWidth = 1;
    const startX = -300;
    const endX = FIELD.width + 320;
    const startY = WATER.y0 - 90;
    const endY = FIELD.height + 220;
    for (let k = 0; k < 46; k += 1) {
      const offset = k * spacing + drift;
      ctx.strokeStyle = k % 4 === 0 ? PALETTE.gridBright : PALETTE.grid;
      ctx.beginPath();
      ctx.moveTo(startX + offset * 0.5, startY);
      ctx.lineTo(startX - 240 + offset * 0.5 + (endY - startY) * 0.5, endY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(endX - offset * 0.5, startY);
      ctx.lineTo(endX + 240 - offset * 0.5 - (endY - startY) * 0.5, endY);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The lighthouse: tower, lamp and the delivery ring that pulls cargo home. */
  function drawLighthouse(world, time, reducedMotion) {
    const ring = world.state.ring;
    const pulse = reducedMotion ? 0.6 : 0.55 + 0.25 * Math.sin(time * 1.9);

    // The tower, drawn before the ring so cargo reads on top of it.
    const baseY = 686;
    ctx.save();
    waterShadow(ctx, ring.x + 10, baseY + 6, 62, 20, 0.5);
    ctx.fillStyle = rgba('#081428', 0.98);
    ctx.beginPath();
    ctx.moveTo(ring.x - 30, baseY);
    ctx.lineTo(ring.x - 14, baseY - 250);
    ctx.lineTo(ring.x + 14, baseY - 250);
    ctx.lineTo(ring.x + 30, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(PALETTE.teal, 0.35);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = rgba(PALETTE.tealDim, 0.5);
    for (let i = 0; i < 4; i += 1) {
      ctx.fillRect(ring.x - 22 + i * 2, baseY - 90 - i * 48, 44 - i * 4, 6);
    }
    ctx.fillStyle = rgba('#0d2340', 1);
    ctx.fillRect(ring.x - 20, baseY - 292, 40, 44);
    ctx.restore();

    // The lamp and its long pale beam of welcome.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lampY = baseY - 270;
    const lamp = ctx.createRadialGradient(ring.x, lampY, 2, ring.x, lampY, 150);
    lamp.addColorStop(0, rgba(PALETTE.beam, 0.9));
    lamp.addColorStop(0.35, rgba(PALETTE.teal, 0.3));
    lamp.addColorStop(1, rgba(PALETTE.teal, 0));
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.arc(ring.x, lampY, 150, 0, TAU);
    ctx.fill();

    const column = ctx.createLinearGradient(0, lampY, 0, lampY + 420);
    column.addColorStop(0, rgba(PALETTE.beam, 0.24));
    column.addColorStop(1, rgba(PALETTE.beam, 0));
    ctx.fillStyle = column;
    ctx.beginPath();
    ctx.moveTo(ring.x - 12, lampY);
    ctx.lineTo(ring.x + 12, lampY);
    ctx.lineTo(ring.x + 54, lampY + 420);
    ctx.lineTo(ring.x - 54, lampY + 420);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // The ring: concentric teal circles with a turning dashed halo.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(ring.x, ring.y, ring.radius * 0.2, ring.x, ring.y, ring.radius * 1.4);
    glow.addColorStop(0, rgba(PALETTE.ring, 0.08));
    glow.addColorStop(0.7, rgba(PALETTE.ring, 0.26));
    glow.addColorStop(1, rgba(PALETTE.ring, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius * 1.4, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(PALETTE.ring, 0.38 + pulse * 0.45);
    ctx.beginPath();
    ctx.ellipse(ring.x, ring.y, ring.radius, ring.radius * 0.78, 0, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.setLineDash([16, 14]);
    ctx.lineDashOffset = reducedMotion ? 0 : -time * 34;
    ctx.strokeStyle = rgba(PALETTE.ring, 0.7);
    ctx.beginPath();
    ctx.ellipse(ring.x, ring.y, ring.radius * 0.78, ring.radius * 0.61, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 15px ' + '"Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = rgba(PALETTE.ring, 0.75);
    ctx.fillText('DELIVER', ring.x, ring.y + 6);
    ctx.restore();
  }

  /** Sweeping storm beams: additive pale-teal wedges with a bright core. */
  function drawBeams(world, time, reducedMotion) {
    const { beams } = world.state;
    const skiff = world.state.skiff;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const beam of beams) {
      const flicker = reducedMotion ? 0.7 : 0.62 + 0.22 * Math.sin(time * 7 + beam.phase);
      const endX = beam.x + Math.cos(beam.angle) * BEAM.length;
      const endY = beam.y + Math.sin(beam.angle) * BEAM.length;
      const grad = ctx.createLinearGradient(beam.x, beam.y, endX, endY);
      grad.addColorStop(0, rgba(PALETTE.beam, 0.5 * flicker + 0.14));
      grad.addColorStop(0.55, rgba(PALETTE.beam, 0.26 * flicker));
      grad.addColorStop(1, rgba(PALETTE.teal, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(beam.x, beam.y);
      ctx.arc(beam.x, beam.y, BEAM.length, beam.angle - beam.width, beam.angle + beam.width);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = rgba(PALETTE.beamCore, 0.30 * flicker);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(beam.x, beam.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // Motes running down the beam.
      const motes = reducedMotion ? 5 : 11;
      for (let i = 0; i < motes; i += 1) {
        const t = ((time * 0.55 + i / motes + beam.phase * 0.1) % 1);
        const distance = t * BEAM.length;
        const wobble = Math.sin(time * 3 + i) * 6;
        const mx = beam.x + Math.cos(beam.angle) * distance - Math.sin(beam.angle) * wobble;
        const my = beam.y + Math.sin(beam.angle) * distance + Math.cos(beam.angle) * wobble;
        ctx.globalAlpha = (1 - t) * 0.5;
        ctx.fillStyle = PALETTE.beamCore;
        ctx.beginPath();
        ctx.arc(mx, my, 2.1, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // A warning rim on any beam about to catch the skiff: the fairest kind of telegraph.
    for (const beam of beams) {
      if (!beamHitsBeam(beam, skiff.x, skiff.y, SKIFF.radius + 34)) continue;
      ctx.save();
      ctx.strokeStyle = rgba(PALETTE.coral, 0.75);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(skiff.x, skiff.y, 30, 0, TAU);
      ctx.stroke();
      ctx.restore();
      break;
    }
  }

  /** Drifting wrecks: coral iso hulls with rust streaks and a slick of shadow. */
  function drawWrecks(world) {
    for (const wreck of world.state.wrecks) {
      const size = wreck.radius * 1.5;
      waterShadow(ctx, wreck.x + size * 0.1, wreck.y + size * 0.3, size * 0.72, size * 0.3, 0.4);
      ctx.save();
      ctx.translate(wreck.x, wreck.y);
      ctx.rotate(Math.sin(wreck.angle) * 0.16);
      isoCube(ctx, 0, 0, size, size * 0.34, {
        top: PALETTE.coralDark,
        left: '#4a1a17',
        right: '#34110f',
      });
      ctx.strokeStyle = rgba(PALETTE.coral, 0.5);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-size * 0.3, -size * 0.2);
      ctx.lineTo(size * 0.24, -size * 0.12);
      ctx.moveTo(-size * 0.22, -size * 0.05);
      ctx.lineTo(size * 0.3, 0.02 * size);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Amber salvage, pulsing brighter when the tether has it. */
  function drawSalvage(world, time, reducedMotion) {
    for (const item of world.state.salvage) {
      const pulse = reducedMotion ? 0.6 : 0.55 + 0.3 * Math.sin(time * 2.4 + item.bob);
      waterShadow(ctx, item.x + 3, item.y + 9, 17, 7, 0.5);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(item.x, item.y, 1, item.x, item.y, 44);
      glow.addColorStop(0, rgba(item.hooked ? PALETTE.amberLit : PALETTE.amber, 0.36 * pulse));
      glow.addColorStop(1, rgba(PALETTE.amber, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(item.x, item.y, 44, 0, TAU);
      ctx.fill();
      ctx.restore();

      const bob = Math.sin(time * 1.6 + item.bob) * 1.6;
      isoCube(ctx, item.x, item.y + bob, 30, 15, {
        top: item.hooked ? PALETTE.amberLit : PALETTE.amber,
        left: PALETTE.amberDark,
        right: '#71490c',
      });
      ctx.save();
      ctx.strokeStyle = rgba(item.hooked ? PALETTE.ring : '#f6d99a', 0.8);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(item.x - 15, item.y + bob - 15);
      ctx.lineTo(item.x + 15, item.y + bob - 15);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** The ropes: one sagging curve per hooked crate, with tension ticks that march along it. */
  function drawTethers(world, time) {
    const sk = world.state.skiff;
    for (const item of world.state.hooked) {
      const dx = item.x - sk.x;
      const dy = item.y - sk.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d;
      const ny = dx / d;
      const sag = Math.min(18, Math.max(0, (d - 60) * 0.14));
      const cx = sk.x + dx * 0.5 + nx * sag;
      const cy = sk.y + dy * 0.5 + ny * sag;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba('#04101c', 0.6);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(sk.x, sk.y);
      ctx.quadraticCurveTo(cx, cy, item.x, item.y);
      ctx.stroke();
      ctx.strokeStyle = rgba(PALETTE.teal, 0.85);
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.strokeStyle = rgba('#d8fff9', 0.6);
      ctx.lineWidth = 1;
      ctx.stroke();

      for (let i = 1; i < 7; i += 1) {
        const t = i / 7;
        const px = (1 - t) * (1 - t) * sk.x + 2 * (1 - t) * t * cx + t * t * item.x;
        const py = (1 - t) * (1 - t) * sk.y + 2 * (1 - t) * t * cy + t * t * item.y;
        const travel = (time * 0.9 + i * 0.13) % 1;
        ctx.globalAlpha = 0.25 + travel * 0.5;
        ctx.fillStyle = PALETTE.beamCore;
        ctx.beginPath();
        ctx.arc(px, py, 1.7, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  /** The skiff: a pointed iso hull, a cabin, a lamp, a wake of foam. */
  function drawSkiff(world, time, reducedMotion) {
    const sk = world.state.skiff;
    const bob = Math.sin(time * SKIFF.bobSpeed) * SKIFF.bobAmplitude;
    const speed = Math.hypot(sk.vx, sk.vy);

    waterShadow(ctx, sk.x + 4, sk.y + 12, 30, 11, 0.55);

    // Wake: capsules laid back along the reverse of the heading.
    if (speed > 24) {
      const back = Math.atan2(-sk.vy, -sk.vx);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 1; i <= 7; i += 1) {
        const distance = i * (12 + speed * 0.045);
        const alpha = 0.16 * (1 - i / 8) * (reducedMotion ? 0.6 : 1);
        ctx.fillStyle = rgba(PALETTE.beam, alpha);
        ctx.beginPath();
        ctx.ellipse(
          sk.x + Math.cos(back) * distance,
          sk.y + Math.sin(back) * distance + bob * 0.4,
          7 + i * 2.4,
          4 + i * 1.3,
          back,
          0,
          TAU,
        );
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(sk.x, sk.y + bob);
    ctx.rotate(sk.angle + Math.PI / 2);
    // Hull.
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(13, 2);
    ctx.lineTo(11, 16);
    ctx.lineTo(-11, 16);
    ctx.lineTo(-13, 2);
    ctx.closePath();
    ctx.fillStyle = '#1a4266';
    ctx.fill();
    ctx.strokeStyle = rgba(PALETTE.beam, 0.95);
    ctx.lineWidth = 2.2;
    ctx.stroke();
    // Deck.
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(8, 0);
    ctx.lineTo(0, 12);
    ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.fillStyle = '#2f7fa4';
    ctx.fill();
    // Cabin.
    ctx.beginPath();
    ctx.moveTo(-6, -2);
    ctx.lineTo(6, -2);
    ctx.lineTo(5, 7);
    ctx.lineTo(-5, 7);
    ctx.closePath();
    ctx.fillStyle = '#0b2033';
    ctx.fill();
    ctx.strokeStyle = rgba(PALETTE.beam, 0.7);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // Mast lamp.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lamp = ctx.createRadialGradient(sk.x, sk.y + bob - 6, 1, sk.x, sk.y + bob - 6, 52);
    lamp.addColorStop(0, rgba(PALETTE.beam, 0.5));
    lamp.addColorStop(1, rgba(PALETTE.beam, 0));
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.arc(sk.x, sk.y + bob - 6, 52, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (sk.invuln > 0) {
      ctx.save();
      ctx.strokeStyle = rgba(PALETTE.beamCore, 0.35 + 0.3 * Math.sin(time * 20));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sk.x, sk.y + bob, 30, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** A vignette and a faint scanline wash to sink the whole scene into the dark. */
  function drawGrade(reducedMotion) {
    const vignette = ctx.createRadialGradient(
      FIELD.width * 0.5,
      FIELD.height * 0.55,
      FIELD.height * 0.35,
      FIELD.width * 0.5,
      FIELD.height * 0.5,
      FIELD.width * 0.78,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(2,5,12,0.46)');
    ctx.fillStyle = vignette;
    ctx.fillRect(-260, -200, FIELD.width + 520, FIELD.height + 420);
    if (!reducedMotion) {
      ctx.fillStyle = 'rgba(120, 200, 220, 0.016)';
      for (let y = WATER.y0; y < FIELD.height + 200; y += 4) ctx.fillRect(-260, y, FIELD.width + 520, 2);
    }
  }

  return {
    particles,

    get transform() {
      return { scale, offsetX, offsetY, viewW, viewH };
    },

    resize(cssWidth, cssHeight, dpr) {
      viewW = Math.max(320, Math.floor(cssWidth));
      viewH = Math.max(240, Math.floor(cssHeight));
      const ratio = Math.min(dpr || 1, 2);
      canvas.width = Math.floor(viewW * ratio);
      canvas.height = Math.floor(viewH * ratio);
      canvas.style.width = `${viewW}px`;
      canvas.style.height = `${viewH}px`;
      // Fit the logical width; if that would show less than 600 logical pixels of height
      // (a very tall window), scale down so the harbour is never cropped.
      scale = viewW / FIELD.width;
      if (viewH / scale < 600) scale = viewH / 600;
      offsetX = (viewW - FIELD.width * scale) / 2;
      offsetY = (viewH - FIELD.height * scale) / 2;
      return { scale, offsetX, offsetY };
    },

    /** Convert a client point to logical harbour coordinates (used by the pointer readout). */
    toLogical(clientX, clientY, rect) {
      return {
        x: (clientX - rect.left - offsetX) / scale,
        y: (clientY - rect.top - offsetY) / scale,
      };
    },

    shake(amount) {
      shakeAmount = Math.min(18, shakeAmount + amount);
      shakeSeed += 1;
    },

    /**
     * Paint one frame. `time` drives the ambient motion (waves, motes, dashes), so a frozen
     * simulation still breathes; the world itself is never modified here.
     */
    draw(world, options = {}) {
      const reducedMotion = options.reducedMotion === true;
      const time = options.time ?? world.state.t;
      const dt = options.dt ?? 1 / 60;

      stepParticles(dt, reducedMotion);
      ingest(world);
      if (shakeAmount > 0) shakeAmount = Math.max(0, shakeAmount - dt * 26);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = PALETTE.seaBottom;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const jitter = reducedMotion ? 0 : shakeAmount;
      const jx = jitter === 0 ? 0 : Math.sin(shakeSeed * 3.1 + time * 41) * jitter;
      const jy = jitter === 0 ? 0 : Math.cos(shakeSeed * 2.3 + time * 37) * jitter;

      // Device pixels per logical unit, then the centred offset and the shake.
      const ratio = canvas.width / viewW;
      ctx.setTransform(ratio, 0, 0, ratio, offsetX * ratio + jx, offsetY * ratio + jy);

      const sky = ctx.createLinearGradient(0, -180, 0, WATER.y0 + 40);
      sky.addColorStop(0, PALETTE.skyTop);
      sky.addColorStop(1, PALETTE.skyBottom);
      ctx.fillStyle = sky;
      ctx.fillRect(-260, -200, FIELD.width + 520, WATER.y0 + 240);

      drawHarbourBackdrop(time, reducedMotion);
      drawSeaGrid(time, reducedMotion);
      drawLighthouse(world, time, reducedMotion);
      drawBeams(world, time, reducedMotion);
      drawWrecks(world);
      drawSalvage(world, time, reducedMotion);
      drawTethers(world, time);
      drawSkiff(world, time, reducedMotion);
      drawParticles(reducedMotion);
      drawGrade(reducedMotion);

      // The HUD and the screens are drawn by the caller, in the same harbour coordinates.
      if (options.overlay) options.overlay(ctx);

      return { time };
    },
  };
}
