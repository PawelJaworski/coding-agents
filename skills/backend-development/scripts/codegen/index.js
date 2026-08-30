#!/usr/bin/env node
// Event-model -> Java scaffolding generator. Domain-agnostic: everything
// project-specific comes from <project>/codegen.config.json, so this script is
// reusable across every project that uses the sliced event-sourced architecture.
//
//   node <skill>/scripts/codegen                 regenerate (cwd = project root)
//   node <skill>/scripts/codegen --check         CI gate: fail if stale
//   node <skill>/scripts/codegen --json          print the parsed model
//   node <skill>/scripts/codegen --project <dir> --model <dir>   explicit paths

import fs from 'node:fs';
import path from 'node:path';
import { parseModel } from './parse.js';
import { emit } from './emit.js';

const CONFIG_FILE = 'codegen.config.json';
const DEFAULTS = {
  modelDir: '../docs',
  mainSourceRoot: 'src/main/java',
  testSourceRoot: 'src/test/java',
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const check = args.includes('--check');

const projectRoot = findProjectRoot(path.resolve(flag('project') || process.cwd()));
const configPath = projectRoot && path.join(projectRoot, CONFIG_FILE);

// The project root is wherever codegen.config.json lives, searched upwards from
// cwd. That makes the generator runnable from any directory in the project with
// no wrapper script and no path juggling.
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

if (!projectRoot) {
  die(
    `CONFIG ERROR  No ${CONFIG_FILE} found in ${path.resolve(
      flag('project') || process.cwd(),
    )} or any parent directory.\n` +
      `  Create one at your project root:\n\n` +
      `    { "basePackage": "com.example.myapp", "modelDir": "../docs" }\n`,
  );
}

const config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
if (!config.basePackage) die(`CONFIG ERROR  ${CONFIG_FILE} must declare "basePackage".`);

const modelDir = path.resolve(projectRoot, flag('model') || config.modelDir);
const mainRoot = path.resolve(projectRoot, config.mainSourceRoot);
const testRoot = path.resolve(projectRoot, config.testSourceRoot);

let files;
try {
  const model = parseModel({ modelDir, basePackage: config.basePackage });
  if (args.includes('--json')) {
    console.log(JSON.stringify(model, null, 2));
    process.exit(0);
  }
  files = emit(model);
} catch (err) {
  die(`MODEL ERROR  ${err.message}`);
}

const written = [];
const preserved = [];
const stale = [];

for (const file of files) {
  const root = file.test ? testRoot : mainRoot;
  const target = path.join(root, ...file.package.split('.'), `${file.className}.java`);
  const exists = fs.existsSync(target);

  // `once` files are scaffolded then owned by the project (deciders, runtime).
  if (file.once && exists) {
    preserved.push(path.relative(projectRoot, target));
    continue;
  }
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === file.content) continue;

  if (check) {
    stale.push(path.relative(projectRoot, target));
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, file.content);
  written.push(`${exists ? 'updated' : 'created'}  ${path.relative(projectRoot, target)}`);
}

if (check) {
  if (stale.length) {
    console.error(`\n  OUT OF DATE  ${stale.length} generated file(s) differ from the model:`);
    stale.forEach((f) => console.error(`    ${f}`));
    console.error(`\n  Run the codegen script to refresh them.\n`);
    process.exit(1);
  }
  console.log('codegen: up to date');
  process.exit(0);
}

written.forEach((w) => console.log(`  ${w}`));
if (preserved.length) {
  console.log(`\n  kept (yours, scaffolded once):`);
  preserved.forEach((s) => console.log(`    ${s}`));
}
console.log(
  `\n  ${written.length} written, ${preserved.length} preserved, ` +
    `${files.length - written.length - preserved.length} unchanged`,
);
