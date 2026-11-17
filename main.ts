// TIDEBINDER — the hand-in program for make.fun's best-game-01 bounty.
//
// The game itself is plain static files under game/: index.html, one ES module per responsibility
// (input, simulation, render, audio, HUD, shots, main) and no library and no network request. This
// program is the only build step there is. It copies game/ and screenshots/ from beside this file
// into the output directory and writes dossier.json with the kit's vendored buildDossier, so the
// summary the judge reads is byte for byte what that library writes from these files.
//
// Run it with Node 22 or later (type stripping, no build):
//   MAKEFUN_OUTPUT_DIR=out node main.ts
// Outside the grader's container MAKEFUN_OUTPUT_DIR stands in for /output. To play it locally:
//   node serve.ts            then open http://localhost:8080

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Walk a tree and return { files, directories, bytes } so the report is honest. */
function measure(root: string): { files: number; directories: number; bytes: number } {
  if (!existsSync(root)) return { files: 0, directories: 0, bytes: 0 };
  let files = 0;
  let directories = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current)) {
      const path = join(current, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        directories += 1;
        stack.push(path);
      } else {
        files += 1;
        bytes += stats.size;
      }
    }
  }
  return { files, directories, bytes };
}

const before = measure(gameDir);
const shotsBefore = measure(shotsDir);

mkdirSync(outputDir, { recursive: true });
cpSync(gameDir, join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(shotsDir)) {
  for (const name of readdirSync(shotsDir)) {
    cpSync(join(shotsDir, name), join(outputDir, 'screenshots', name), { recursive: true });
  }
}

// The scorer's caps (reference/gate.json). The numbers below are the ones the dossier carries;
// anything the game exceeds would be refused by the scorer, so the report below checks them too.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

const dossier = buildDossier(outputDir, CAPS);
writeFileSync(join(outputDir, 'dossier.json'), dossier);

const shotsAfter = measure(join(outputDir, 'screenshots'));
const oversized = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((name) => statSync(join(shotsDir, name)).size > CAPS.screenshots.max_bytes)
  : [];

console.log(`TIDEBINDER handed in to ${outputDir}`);
console.log(
  `  game/    ${before.files} files, ${before.directories} directories, ${before.bytes} bytes` +
    (before.bytes > CAPS.game_max_bytes ? '  (over the 48 MiB cap)' : ''),
);
console.log(
  `  screenshots/  ${shotsAfter.files} images, ${shotsBefore.bytes} bytes` +
    (oversized.length > 0 ? `  OVERSIZED: ${oversized.join(', ')}` : ''),
);
console.log(`  dossier.json  ${dossier.length} bytes`);
