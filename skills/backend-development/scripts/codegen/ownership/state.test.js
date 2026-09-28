// generator-state.json — the two facts no scan of the source can recover.
//
// `preserved` is a PATH LIST and nothing finer, deliberately: a declaration
// silences a whole file, exactly as the generator behaves, and per-member detail
// would be a cached answer nothing reads.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emptyState,
  isPreserved,
  normalizeRelPath,
  pruneStaleState,
  readGeneratorState,
  recordPreserved,
  recordScaffoldVersion,
  scaffoldVersion,
  writeGeneratorState,
  STATE_FILE,
} from './state.js';

const withTempProject = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegen-state-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// --- paths and lookups ------------------------------------------------------

test('paths are normalised to project-relative forward slashes', () => {
  assert.equal(normalizeRelPath('src\\main\\java\\C.java'), 'src/main/java/C.java');
  assert.equal(normalizeRelPath('src/main/java/C.java'), 'src/main/java/C.java');
});

test('a file with no recorded version reads as v0 — exactly what a pre-bookkeeping file is', () => {
  assert.equal(scaffoldVersion(emptyState(), 'src/main/java/A.java'), 0);
});

test('recorded versions are looked up on the normalised path', () => {
  const state = emptyState();
  recordScaffoldVersion(state, 'src\\main\\java\\A.java', 3);
  assert.equal(scaffoldVersion(state, 'src/main/java/A.java'), 3);
});

test('isPreserved answers for a whole class, and for nothing else', () => {
  const state = emptyState();
  recordPreserved(state, 'src/main/java/A.java');
  assert.equal(isPreserved(state, 'src/main/java/A.java'), true);
  assert.equal(isPreserved(state, 'src\\main\\java\\A.java'), true, 'path form must not matter');
  assert.equal(isPreserved(state, 'src/main/java/B.java'), false);
});

test('recording the same class twice is not two declarations', () => {
  const state = emptyState();
  recordPreserved(state, 'src/main/java/A.java');
  recordPreserved(state, 'src/main/java/A.java');
  assert.deepEqual(state.preserved, ['src/main/java/A.java']);
});

// --- round trip -------------------------------------------------------------

test('state round-trips through disk with stable key order', () => {
  withTempProject((dir) => {
    const state = emptyState();
    recordScaffoldVersion(state, 'src/main/java/Z.java', 2);
    recordScaffoldVersion(state, 'src/main/java/A.java', 1);
    recordPreserved(state, 'src/main/java/Z.java');
    recordPreserved(state, 'src/main/java/A.java');

    writeGeneratorState(dir, state);
    const text = fs.readFileSync(path.join(dir, STATE_FILE), 'utf8');
    assert.ok(text.indexOf('"src/main/java/A.java"') < text.indexOf('"src/main/java/Z.java"'), 'sorted');

    const { state: loaded, error } = readGeneratorState(dir);
    assert.equal(error, null);
    assert.deepEqual(loaded.scaffoldVersions, state.scaffoldVersions);
    assert.deepEqual(loaded.preserved, ['src/main/java/A.java', 'src/main/java/Z.java']);

    // Canonical form is a fixed point: re-serialising must not churn the diff.
    writeGeneratorState(dir, loaded);
    assert.equal(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8'), text);
  });
});

test('a missing state file reads as empty, not as an error', () => {
  withTempProject((dir) => {
    const { state, error } = readGeneratorState(dir);
    assert.equal(error, null);
    assert.deepEqual(state, emptyState());
  });
});

test('a malformed state file is an error — the bookkeeping cannot be trusted', () => {
  withTempProject((dir) => {
    fs.writeFileSync(path.join(dir, STATE_FILE), '{ not json');
    const { error } = readGeneratorState(dir);
    assert.match(error, /not valid JSON/);
  });
});

test('an older {path, member, reason} entry degrades to its path instead of breaking', () => {
  withTempProject((dir) => {
    fs.writeFileSync(
      path.join(dir, STATE_FILE),
      JSON.stringify({
        scaffoldVersions: { 'a/B.java': 2, 'a/C.java': 'x', 'a/D.java': -1 },
        preserved: [{ path: 'a/B.java', member: 'void go()', reason: 'r' }, 'a/E.java', null, { reason: 'no path' }],
      }),
    );
    const { state, error } = readGeneratorState(dir);
    assert.equal(error, null);
    assert.deepEqual(state.scaffoldVersions, { 'a/B.java': 2 }, 'non-integer versions are dropped');
    assert.deepEqual(state.preserved, ['a/B.java', 'a/E.java']);
  });
});

// --- pruning inert bookkeeping ----------------------------------------------

const facts = (over = {}) =>
  new Map([['src/main/java/A.java', { exists: true, deviates: true, ...over }]]);

test('a declaration for a file that is gone is inert and dropped', () => {
  const state = emptyState();
  recordPreserved(state, 'gone/G.java');
  recordScaffoldVersion(state, 'gone/G.java', 2);

  const dropped = pruneStaleState(state, facts());

  assert.deepEqual(state, emptyState());
  assert.equal(dropped.length, 2);
});

test('a declaration for a class that matches the model again is dropped', () => {
  const state = emptyState();
  recordPreserved(state, 'src/main/java/A.java');

  const dropped = pruneStaleState(state, facts({ deviates: false }));

  assert.deepEqual(state.preserved, []);
  assert.match(dropped[0], /matches the model again/);
});

test('a live declaration is kept — owning a class is true whether or not it still diverges', () => {
  const state = emptyState();
  recordPreserved(state, 'src/main/java/A.java');
  recordScaffoldVersion(state, 'src/main/java/A.java', 3);

  const dropped = pruneStaleState(state, facts());

  assert.deepEqual(dropped, []);
  assert.deepEqual(state.preserved, ['src/main/java/A.java']);
  assert.equal(state.scaffoldVersions['src/main/java/A.java'], 3);
});
