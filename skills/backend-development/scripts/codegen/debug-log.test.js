import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDebugLogger, DEBUG_LOG_PATH } from './debug-log.js';

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-debug-'));
}

test('top-level codegen appends to the existing debug log', () => {
  const projectRoot = tempProject();
  const file = path.join(projectRoot, DEBUG_LOG_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Backend codegen debug\n\nold session\n');

  const logger = createDebugLogger({
    enabled: true,
    projectRoot,
    argv: ['--next', '--json'],
  });
  logger.log('SELECT_STEP', { step: 'VERIFY' });

  const content = fs.readFileSync(file, 'utf8');
  assert.match(content, /old session/);
  assert.match(content, /# Invocation/);
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

test('disabled debug logging leaves an existing log untouched', () => {
  const projectRoot = tempProject();
  const file = path.join(projectRoot, DEBUG_LOG_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'existing debug session');

  const logger = createDebugLogger({ enabled: false, projectRoot, argv: [] });
  logger.log('PARSE_MODEL');
  logger.prompt('GENERATE_COMMANDS', 'some prompt');

  assert.equal(fs.readFileSync(file, 'utf8'), 'existing debug session');
});

test('prompt() writes the exact, unescaped prompt text in a fenced block', () => {
  const projectRoot = tempProject();
  const logger = createDebugLogger({ enabled: true, projectRoot, argv: ['--next'] });

  const promptText = 'Line one.\nLine two with "quotes" and a trailing note.';
  logger.prompt('GENERATE_COMMANDS', promptText);

  const content = fs.readFileSync(path.join(projectRoot, DEBUG_LOG_PATH), 'utf8');
  assert.match(content, /## PROMPT: GENERATE_COMMANDS/);
  assert.match(content, /```\nLine one\.\nLine two with "quotes" and a trailing note\.\n```/);
});

test('prompt() is a no-op for a null or undefined prompt', () => {
  const projectRoot = tempProject();
  const file = path.join(projectRoot, DEBUG_LOG_PATH);
  const logger = createDebugLogger({ enabled: true, projectRoot, argv: ['--next'] });

  logger.prompt('DONE', null);
  logger.prompt('DONE', undefined);

  const content = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(content, /## PROMPT/);
});
