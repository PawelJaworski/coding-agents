#!/usr/bin/env node
// Event-model -> Angular page scaffolding generator. Framework-specific but
// domain-agnostic: everything project-specific comes from
// <project>/fecodegen.config.json, so this script is reusable across every
// frontend that renders a sliced event-sourced model.
//
//   node <skill>/scripts/codegen              regenerate (cwd = project root)
//   node <skill>/scripts/codegen --check      CI gate: fail if stale
//   node <skill>/scripts/codegen --json       print the parsed model
//   node <skill>/scripts/codegen --project <dir> --model <dir>

import fs from 'node:fs';
import path from 'node:path';
import { parseModel } from './parse.js';
import { emit } from './emit.js';

const CONFIG_FILE = 'fecodegen.config.json';
const DEFAULTS = {
  modelDir: '../docs',
  appRoot: 'src/app',
  pagesRoot: 'src/app/pages',
  apiBase: '/api',
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const check = args.includes('--check');

// The project root is wherever fecodegen.config.json lives, searched upwards
// from cwd — runnable from any directory with no wrapper and no path juggling.
function findProjectRoot(start) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const die = (msg) => {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
};

const projectRoot = findProjectRoot(path.resolve(flag('project') || process.cwd()));
if (!projectRoot) {
  die(
    `CONFIG ERROR  No ${CONFIG_FILE} found in ${path.resolve(flag('project') || process.cwd())} ` +
      `or any parent directory.\n  Create one at your project root:\n\n` +
      `    { "modelDir": "../docs", "pagesRoot": "src/app/pages", "apiBase": "/api" }\n`,
  );
}

const config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(path.join(projectRoot, CONFIG_FILE), 'utf8')) };
const modelDir = path.resolve(projectRoot, flag('model') || config.modelDir);

let model;
let files;
try {
  model = parseModel({ modelDir });
  if (args.includes('--json')) {
    console.log(JSON.stringify(model, null, 2));
    process.exit(0);
  }
  files = emit(model, { pagesRoot: config.pagesRoot, apiBase: config.apiBase });
} catch (err) {
  die(`MODEL ERROR  ${err.message}`);
}

const written = [];
const preserved = [];
const stale = [];

for (const file of files) {
  const target = path.join(projectRoot, file.path);
  const exists = fs.existsSync(target);

  // `once` files are scaffolded then owned by the project (stores, templates,
  // styles, specs) — the frontend equivalent of a backend *Decider.
  if (file.once && exists) {
    preserved.push(file.path);
    continue;
  }
  if (exists && fs.readFileSync(target, 'utf8') === file.content) continue;

  if (check) {
    stale.push(file.path);
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, file.content);
  written.push(`${exists ? 'updated' : 'created'}  ${file.path}`);
}

if (check) {
  if (stale.length) {
    console.error(`\n  OUT OF DATE  ${stale.length} generated file(s) differ from the model:`);
    stale.forEach((f) => console.error(`    ${f}`));
    console.error(`\n  Run the codegen script to refresh them.\n`);
    process.exit(1);
  }
  console.log('fe-codegen: up to date');
  process.exit(0);
}

written.forEach((w) => console.log(`  ${w}`));
if (preserved.length) {
  console.log(`\n  kept (yours, scaffolded once):`);
  preserved.forEach((s) => console.log(`    ${s}`));
}
if (model.skipped.length) {
  console.log(`\n  skipped (not Type: html):`);
  model.skipped.forEach((u) => console.log(`    ${u.id}  [${u.type}]`));
}

// app.routes.ts is yours, so the generator cannot wire it — but a page that is
// generated and never routed is invisible, which is the one failure this script
// can detect but not fix.
const appRoutes = path.join(projectRoot, config.appRoot, 'app.routes.ts');
if (model.pages.length && fs.existsSync(appRoutes)) {
  if (!fs.readFileSync(appRoutes, 'utf8').includes('pageRoutes')) {
    console.log(
      `\n  ACTION REQUIRED  ${config.appRoot}/app.routes.ts does not spread the generated routes.\n` +
        `    import { pageRoutes } from './pages/pages.routes';\n` +
        `    export const routes: Routes = [ ...pageRoutes, /* your own */ ];`,
    );
  }
}

console.log(
  `\n  ${model.pages.length} page(s) from ${model.uis.length} UI(s) — ` +
    `${written.length} written, ${preserved.length} preserved, ` +
    `${files.length - written.length - preserved.length} unchanged`,
);
