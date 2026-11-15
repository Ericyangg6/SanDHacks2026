// Runs one of the TypeScript dev scripts in this folder:
//   node src/m4/dev/run.mjs <script> [args...]      e.g. node src/m4/dev/run.mjs send-test
// The M4 sources use bundler-style imports, so the script is bundled first with the esbuild that mastra
// installs. Variables come from apps/api/.env and the repo-root .env; ones already set in the shell win.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const devDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(devDir, '../../..');

const name = process.argv[2];
const entry = name ? path.join(devDir, `${name}.ts`) : null;
if (!entry || !existsSync(entry)) {
  console.error('Usage: node src/m4/dev/run.mjs <script> [args...]');
  console.error(`No script named "${name ?? ''}" in ${path.relative(process.cwd(), devDir) || '.'}`);
  process.exit(1);
}

for (const file of [path.join(appDir, '.env'), path.resolve(appDir, '../../.env')]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const outfile = path.join(appDir, 'node_modules/.cache/m4-dev', `${name}.mjs`);
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  logLevel: 'warning',
});

// The script reads its own arguments from process.argv.slice(3).
await import(pathToFileURL(outfile).href);
