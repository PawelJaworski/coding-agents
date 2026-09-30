// Spec hygiene: a Spock spec reaches production through the generated *Ability
// DSLs. `new`-ing a production collaborator in a spec bypasses those DSLs and
// couples the test to wiring the abilities exist to own — and a test-only double
// can silently stand in for logic production lacks. This is the mechanical
// enforcement of the rule the GWT prompt states prose-only.

import fs from 'node:fs';
import path from 'node:path';

const CONSTRUCTION = /\bnew\s+([A-Z][A-Za-z0-9_]*)\s*\(/g;

/** Concrete production wiring — always forbidden in a spec. */
const FORBIDDEN_EXACT = new Set([
  'EventStreamImpl',
  'AggregateIdSequence',
  'DomainEventSerde',
  'DomainEventSerdeWrapper',
]);

/** Generated collaborator shapes — forbidden wherever their suffix appears. */
const FORBIDDEN_SUFFIX = /(Handler|Projector|Repository|Entity|Event|Ability)$/;

/** The *Ability that owns the collaborator, as a best-effort pointer. */
export function forbiddenSuggestion(name) {
  if (name === 'EventStreamImpl') return 'EventStreamAbility';
  if (name === 'AggregateIdSequence') return 'AggregateIdSequenceAbility';
  if (/Handler$/.test(name)) return `${name.slice(0, -'Handler'.length)}Ability`;
  if (/Projector$/.test(name)) return `${name}Ability`;
  if (/InMemoryRepository$/.test(name)) {
    return `${name.slice(0, -'InMemoryRepository'.length)}ProjectorAbility`;
  }
  if (/Repository$/.test(name)) return `${name.slice(0, -'Repository'.length)}ProjectorAbility`;
  return 'the sibling *Ability DSL';
}

export function isForbiddenConstruction(name) {
  return FORBIDDEN_EXACT.has(name) || FORBIDDEN_SUFFIX.test(name);
}

/** Comments and string literals blanked, so prose never triggers the scan. */
function blankNoise(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/**
 * Pure: production types constructed in one spec's source.
 *
 * @param {string} content - a Groovy spec source
 * @returns {{line: number, type: string, suggestion: string, snippet: string}[]}
 */
export function scanSpecContent(content) {
  const violations = [];
  blankNoise(content)
    .split('\n')
    .forEach((line, index) => {
      for (const match of line.matchAll(CONSTRUCTION)) {
        const type = match[1];
        if (!isForbiddenConstruction(type)) continue;
        violations.push({
          line: index + 1,
          type,
          suggestion: forbiddenSuggestion(type),
          snippet: line.trim(),
        });
      }
    });
  return violations;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

/**
 * Scan every `*Spec.groovy` under the Groovy source root.
 *
 * @param {{groovyTestRoot: string, projectRoot?: string}} params
 * @returns {{file: string, line: number, type: string, suggestion: string, snippet: string}[]}
 */
export function checkSpecHygiene({ groovyTestRoot, projectRoot = groovyTestRoot }) {
  const violations = [];
  for (const full of walk(groovyTestRoot)) {
    if (!full.endsWith('Spec.groovy')) continue;
    const file = path.relative(projectRoot, full);
    for (const v of scanSpecContent(fs.readFileSync(full, 'utf8'))) {
      violations.push({ file, ...v });
    }
  }
  return violations;
}
