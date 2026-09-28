// generator-state.json — the generator's bookkeeping, kept OUT of the source files.
//
// Why this file exists at all: the generator cannot recover two facts from a
// file's content, and neither belongs in that content.
//
//   scaffoldVersions   which template a `once` file was born from. Its body has
//                      since diverged, so the number is unrecoverable — and it
//                      is pure metadata, so it never needed to be near the code.
//   preserved          which files deviate from the model on purpose.
//
// `preserved` is deliberately as coarse as the generator's own behaviour: a
// declaration silences a whole FILE and nothing finer (see patch.js/advisory.js
// — both branch on the file, never on a member). Recording which member and why
// would be the same "cached answer" a source banner is, just in JSON: prose that
// can go stale and that no decision reads.
//
//   - the WHY belongs in the code, as the comment beside the code that needs it.
//   - the WHAT-IF-IT-CHANGES needs no bookkeeping: the class is hand-owned, so
//     the compiler and the tests are the feedback loop. If the model grows a
//     requirement the class does not meet, javac names it. That is the contract.
//
// So a declaration is just a path. Cheap to write, impossible to get subtly
// wrong (no memberKey to match), and one small file answers "which classes has
// the team taken over?" without reading any of them.
//
// Nothing here is validated as a claim about code, because nothing here asserts
// anything about a body. A declaration for a file that is gone, or that matches
// its template again, is simply inert bookkeeping: pruned by any write-mode run.
//
// Paths are project-root-relative with forward slashes — the same spelling
// `--check` and `--patch` print, so one can be pasted into the other.

import fs from 'node:fs';
import path from 'node:path';

export const STATE_FILE = 'generator-state.json';

export function emptyState() {
  return { scaffoldVersions: {}, preserved: [] };
}

export function normalizeRelPath(p) {
  return String(p ?? '').replaceAll('\\', '/');
}

function normalizeState(parsed) {
  const state = emptyState();
  if (!parsed || typeof parsed !== 'object') return state;

  const versions = parsed.scaffoldVersions;
  if (versions && typeof versions === 'object' && !Array.isArray(versions)) {
    for (const [key, value] of Object.entries(versions)) {
      const version = Number(value);
      if (Number.isInteger(version) && version >= 0) {
        state.scaffoldVersions[normalizeRelPath(key)] = version;
      }
    }
  }

  const preserved = parsed.preserved;
  if (Array.isArray(preserved)) {
    for (const entry of preserved) {
      // Strings are the contract. Objects are tolerated and read as their path,
      // so an older `{path, member, reason}` entry degrades instead of breaking.
      const rel = normalizeRelPath(typeof entry === 'string' ? entry : entry?.path);
      if (rel && !state.preserved.includes(rel)) state.preserved.push(rel);
    }
  }
  return state;
}

/**
 * @returns {{state: object, error: string|null}} `error` is set when the file
 * exists but cannot be trusted; the state is then empty and the run must stop.
 */
export function readGeneratorState(projectRoot) {
  const file = path.join(projectRoot, STATE_FILE);
  if (!fs.existsSync(file)) return { state: emptyState(), error: null };
  try {
    return { state: normalizeState(JSON.parse(fs.readFileSync(file, 'utf8'))), error: null };
  } catch (err) {
    return { state: emptyState(), error: `${STATE_FILE} is not valid JSON: ${err.message}` };
  }
}

/** Stable ordering so an unrelated run never churns the diff. */
export function writeGeneratorState(projectRoot, state) {
  const scaffoldVersions = Object.fromEntries(
    Object.entries(state.scaffoldVersions)
      .map(([rel, version]) => [normalizeRelPath(rel), version])
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const preserved = [...new Set(state.preserved.map(normalizeRelPath))].sort((a, b) => a.localeCompare(b));

  fs.writeFileSync(path.join(projectRoot, STATE_FILE), `${JSON.stringify({ scaffoldVersions, preserved }, null, 2)}\n`);
}

/** Files predating this state file read as v0, which is exactly what they are. */
export function scaffoldVersion(state, relPath) {
  return state.scaffoldVersions[normalizeRelPath(relPath)] ?? 0;
}

export function recordScaffoldVersion(state, relPath, version) {
  state.scaffoldVersions[normalizeRelPath(relPath)] = version;
}

/** Has the team taken this file over from the model? */
export function isPreserved(state, relPath) {
  return state.preserved.includes(normalizeRelPath(relPath));
}

export function recordPreserved(state, relPath) {
  const rel = normalizeRelPath(relPath);
  if (!state.preserved.includes(rel)) state.preserved.push(rel);
}

/**
 * Drop bookkeeping that no longer points at anything.
 *
 * Nothing here is a claim to be enforced — a declaration only says "this file is
 * yours now", which is as true of a file that matches its template as of one
 * that diverged. But an entry for a file that is gone, or that has drifted back
 * to exactly what the model would emit, describes nothing and is dropped rather
 * than carried forever.
 *
 * @param {object} state - the loaded generator-state.json (mutated)
 * @param {Map<string, object>} facts - relPath -> {exists, deviates}
 * @returns {string[]} human-readable note of each entry dropped
 */
export function pruneStaleState(state, facts) {
  const dropped = [];

  for (const rel of Object.keys(state.scaffoldVersions)) {
    const fact = facts.get(rel);
    if (!fact || !fact.exists) {
      delete state.scaffoldVersions[rel];
      dropped.push(`${rel}  (scaffold version: file is gone)`);
    }
  }

  state.preserved = state.preserved.filter((rel) => {
    const fact = facts.get(rel);
    if (!fact || !fact.exists) {
      dropped.push(`${rel}  (preserved: file is gone)`);
      return false;
    }
    if (!fact.deviates) {
      dropped.push(`${rel}  (preserved: matches the model again)`);
      return false;
    }
    return true;
  });

  return dropped;
}
