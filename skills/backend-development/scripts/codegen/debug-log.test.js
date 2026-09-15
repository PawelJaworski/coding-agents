import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDebugLogger, DEBUG_LOG_PATH } from './debug-log.js';

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-debug-'));
}

test('top-level codegen replaces the previous debug log', () => {
  const projectRoot = tempProject();
  const file = path.join(projectRoot, DEBUG_LOG_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'old session');

  const logger = createDebugLogger({
    enabled: true,
    projectRoot,
    argv: ['--next', '--json'],
  });
  logger.log('SELECT_STEP', { step: 'VERIFY' });

  const content = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(content, /old session/);
  assert.match(content, /--next --json/);
  assert.match(content, /SELECT_STEP/);
  assert.match(content, /"step": "VERIFY"/);
});

test('nested codegen appends to the current debug log', () => {
  const projectRoot = tempProject();
  const outer = createDebugLogger({ enabled: true, projectRoot, argv: ['--next'] });
  outer.log('REFRESH_PATCHES');

  const nested = createDebugLogger({
    enabled: true,
    projectRoot,
    nested: true,
    argv: ['--patch', '--json'],
  });
  nested.log('PATCH_RESULT', { categories: ['commands'] });

  const content = fs.readFileSync(path.join(projectRoot, DEBUG_LOG_PATH), 'utf8');
  assert.match(content, /--next/);
  assert.match(content, /REFRESH_PATCHES/);
  assert.match(content, /--patch --json/);
  assert.match(content, /PATCH_RESULT/);
});

test('disabled debug logging removes a stale top-level log', () => {
  const projectRoot = tempProject();
  const file = path.join(projectRoot, DEBUG_LOG_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'stale debug session');

  const logger = createDebugLogger({ enabled: false, projectRoot, argv: [] });
  logger.log('PARSE_MODEL');

  assert.equal(fs.existsSync(file), false);
});
