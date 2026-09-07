// GWT Plugin — scans for pending scenarios and business rules
// Unlike emitter plugins, this doesn't generate files — it computes pending work
// by cross-referencing gwt-*.md files and business-rules-raw.md against existing
// Spock specs.

import fs from 'node:fs';
import path from 'node:path';
import { pendingWork, buildQueue, parseSpecNames } from '../next.js';

/**
 * Walk a directory recursively, returning all file paths.
 */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

/**
 * Deterministically pick the command a business rule constrains.
 * Reuses the logic from next.js.
 */
function ruleCommand(rule, commands) {
  //only generic words, scripts should be generic and can be applied to multiple domains
  const STOPWORDS = new Set([
    'a', 'an', 'the', 'must', 'that', 'is', 'has', 'have', 'be', 'with', 'for',
    'of', 'to', 'in', 'on', 'and', 'or', 'not',
  ]);

  function keywordize(text) {
    return new Set(
      String(text)
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((w) => w && !STOPWORDS.has(w)),
    );
  }

  const ruleTokens = keywordize(rule);
  const scored = (commands || []).map((c) => {
    const behavior = keywordize(`${c.id} ${c.name || ''}`);
    const fieldSignals = (c.fields || []).flatMap((f) => [
      f.label,
      ...(f.attrs || []).map((a) => a.name),
    ]);
    const fieldTokens = new Set(fieldSignals.flatMap((s) => [...keywordize(s)]));
    return {
      c,
      fieldHit: [...fieldTokens].some((t) => ruleTokens.has(t)),
      behaviorHit: [...behavior].some((t) => ruleTokens.has(t)),
    };
  });

  const fieldMatches = scored.filter((s) => s.fieldHit);
  if (fieldMatches.length === 1) return fieldMatches[0].c;
  if (fieldMatches.length > 1) return null;

  const behaviorMatches = scored.filter((s) => s.behaviorHit);
  return behaviorMatches.length === 1 ? behaviorMatches[0].c : null;
}

// Step plugin for GENERATE_GWTS
const gwtStep = {
  id: 'GENERATE_GWTS',
  category: 'gwt',
  // Test data is filled before scenarios: a scenario spec overrides only what
  // it cares about, so the defaults it relies on must already exist.
  after: ['GENERATE_COMMANDS', 'GENERATE_READ_MODELS', 'GENERATE_TEST_DATA'],
  detect: (patch) => (patch?.entries ?? []).filter(e => e.auto === false),
  render: (item, index, total) => {
    const left = total - index - 1;
    const isRule = item.kind === 'business-rule';
    const label = isRule ? 'rule' : 'scenario';
    return [
      `GENERATE_GWTS — item ${index + 1}/${total}`,
      '',
      `  ${label}: "${item.name}"`,
      `  source:   <docs>/${item.source}`,
      `  spec:     ${item.spec}`,
      '',
      'Test first: transcribe the name VERBATIM, run it, get a loud failure, then write',
      'the minimal logic in the decider the failure names. Drive it only through *Ability.',
      ...(item.hints ?? []).map((h) => `  ${h}`),
      '',
      `Touch nothing else. ${left > 0 ? `${left} item(s) left in this step.` : 'Last item.'}`
    ].join('\n');
  }
};

/**
 * Hint for a GWT patch entry: the one convention an implementing agent gets
 * wrong and that silently keeps the item pending. `codegen --next` matches a
 * scenario/rule to "done" by an exact spec method name, and parseSpecNames
 * only recognizes double-quoted names (`def "..."`) — single quotes leave the
 * item pending forever.
 */
export function nameQuotesHint(name) {
  return (
    `Write the Spock method name DOUBLE-quoted and verbatim: def "${name}"(). ` +
    'parseSpecNames matches only `def "..."`; a single-quoted name keeps this item pending forever.'
  );
}

// Plugin manifest
export const GWTPlugin = {
  id: 'gwt',
  scanner: {
    id: 'gwt',
    category: 'gwt',
    requires: [],
    scan: (model, ctx) => {
      const { projectRoot, modelDir, groovyTestRoot, basePackage } = ctx;

      // Read business rules
      const businessRulesPath = path.join(modelDir, 'business-rules-raw.md');
      const businessRulesRaw = fs.existsSync(businessRulesPath)
        ? fs.readFileSync(businessRulesPath, 'utf8')
        : '';

      // Read GWT files
      const gwtFiles = walk(modelDir)
        .filter((f) => /^gwt-.*\.md$/.test(path.basename(f)))
        .map((f) => ({ name: path.basename(f), content: fs.readFileSync(f, 'utf8') }));

      // Parse existing specs
      const parsedSpecs = walk(groovyTestRoot)
        .filter((f) => f.endsWith('.groovy'))
        .flatMap((f) => parseSpecNames(fs.readFileSync(f, 'utf8'), path.relative(projectRoot, f)));

      // Compute pending work
      const pending = pendingWork({
        businessRulesRaw,
        gwtFiles,
        parsedSpecs,
        commands: model.commands,
        readModels: model.readModels,
      });

      // Build queue as patch entries
      const queue = buildQueue(pending, { groovyRoot: groovyTestRoot, base: basePackage });

      // Convert queue items to patch entries
      return queue.map((item) => {
        const isRule = item.kind === 'business-rule';
        const name = isRule ? item.detail.rule : item.detail.scenario;
        const where = /`([^`]+Spec\.groovy)`/.exec(item.prompt)?.[1] ?? null;
        const target = isRule ? item.detail.command : item.detail.readModel;
        return {
          op: 'CREATE',
          auto: false,
          category: 'gwt',
          kind: item.kind,
          name,
          source: isRule ? 'business-rules-raw.md' : item.detail.file,
          spec: where,
          package: target?.package ?? null,
          class: where ? where.split('/').pop().replace(/\.groovy$/, '') : null,
          hints: [
            nameQuotesHint(name),
            ...(where ? [] : ['spec path underivable — report it, do not guess']),
          ],
        };
      });
    },
    step: gwtStep
  }
};