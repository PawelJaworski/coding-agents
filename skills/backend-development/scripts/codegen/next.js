// "What should the agent do next?" — turns the pipeline's scattered manual
// checks (run --check, read the error, decide, run backend-implement, repeat)
// into one machine-readable state an agent (or a loop) can act on directly,
// instead of a human interpreting free-text output at every step.
//
// Pure string/array functions so they're unit-testable without a filesystem.

/** Rule sentences from business-rules-raw.md: non-empty lines that are not a
 * `# Aggregate` header. */
export function parseBusinessRules(content) {
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Scenario headings (`## ...`) in a gwt-*.md file's content. */
export function parseGwtScenarios(content) {
  return [...content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
}

/**
 * Spock spec method names under a spec file path. The path is the key that makes
 * a spec name slice-aware: a scenario/rule is only satisfied by a spec in the
 * slice it belongs to, not by a same-named method living anywhere in the tree.
 *
 * @param {string} groovyContent
 * @param {string} specPath - path of the .groovy file (used for location)
 * @returns {{name: string, path: string}[]}
 */
export function parseSpecNames(groovyContent, specPath) {
  return [...groovyContent.matchAll(/def\s+"([^"]+)"\s*\(/g)].map((m) => ({
    name: m[1],
    path: specPath,
  }));
}

// -- slice-aware location helpers -------------------------------------------

// A spec that satisfies a scenario/rule lives at:
//   <groovyRoot>/<base>/<slice>/<SpecClass>Spec.groovy
// where <SpecClass> is the pascal id of the element that owns it — the read model
// for a GWT scenario (policy-details -> PolicyDetails), the command for a rule
// (issue-policy -> IssuePolicy). Clean and suffix-free: no "BusinessRule", no "Cmd".
// e.g. src/test/groovy/pl/pjaworski/examplebackend/policydetails/PolicyDetailsSpec.groovy
export function specPath(groovyRoot, base, slice, specClass) {
  return `${groovyRoot}/${base.split('.').join('/')}/${slice}/${specClass}Spec.groovy`;
}

// pascal form of an element id used for its spec file name (issue-policy -> IssuePolicy).
function specClassOf(id) {
  return String(id)
    .trim()
    .toLowerCase()
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

// -- rule -> command matching -----------------------------------------------

const STOPWORDS = new Set([
  'a', 'an', 'the', 'must', 'that', 'is', 'has', 'have', 'be', 'with', 'for',
  'of', 'to', 'in', 'on', 'and', 'or', 'not', 'issued', 'policy', 'holder',
]);

function keywordize(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w && !STOPWORDS.has(w)),
  );
}

/**
 * Deterministically pick the command a business rule constrains. A rule is
 * matched to a command by looking for the rule's tokens among the command's
 * field signals (its field labels and, for value-object fields, their
 * attributes) and fall back to the command's own behavior words. It only
 * returns a match when the outcome is unambiguous — otherwise null, so the
 * caller surfaces the ambiguity instead of silently guessing a location.
 *
 * @param {string} rule - the raw rule sentence
 * @param {{id:string, name:string, package:string, className:string, fields:object[]}[]} commands
 * @returns {object|null}
 */
export function ruleCommand(rule, commands) {
  const ruleTokens = keywordize(rule);
  const scored = (commands || []).map((c) => {
    const behavior = keywordize(`${c.id} ${c.name || ''}`);
    const fieldSignals = (c.fields || []).flatMap((f) => [
      f.label,
      ...(f.attrs || []).map((a) => a.name),
    ]);
    const fieldTokens = new Set(
      fieldSignals.flatMap((s) => [...keywordize(s)]),
    );
    return {
      c,
      fieldHit: [...fieldTokens].some((t) => ruleTokens.has(t)),
      behaviorHit: [...behavior].some((t) => ruleTokens.has(t)),
    };
  });

  // Prefer an unambiguous field-token match (the rule names a command's field).
  const fieldMatches = scored.filter((s) => s.fieldHit);
  if (fieldMatches.length === 1) return fieldMatches[0].c;
  if (fieldMatches.length > 1) return null; // ambiguous — do not guess

  // Fall back to behavior-word match; still must be unique.
  const behaviorMatches = scored.filter((s) => s.behaviorHit);
  return behaviorMatches.length === 1 ? behaviorMatches[0].c : null;
}

/**
 * Build a lookup of satisfied scenario/rule names indexed by slice, so a
 * same-named spec in the wrong slice is NOT counted as done. A spec's slice is
 * derived from its path: .../<slice>/<ClassName>Spec.groovy.
 *
 * @param {{name:string, path:string}[]} parsedSpecs
 * @returns {Map<string, Set<string>>} slice -> set of satisfied spec names
 */
function satisfiedBySlice(parsedSpecs) {
  const map = new Map();
  for (const { name, path } of parsedSpecs) {
    const dirs = path.replace(/\.groovy$/, '').split('/');
    const slice = dirs[dirs.length - 2]; // .../<slice>/<ClassName>Spec
    if (!slice) continue;
    if (!map.has(slice)) map.set(slice, new Set());
    map.get(slice).add(name);
  }
  return map;
}

/**
 * Cross-reference the model's rules and scenarios against existing spec names,
 * associating each pending item with the slice it MUST live in.
 *
 * @param {object} sources
 * @param {string} sources.businessRulesRaw - business-rules-raw.md content, or ''
 * @param {{name: string, content: string}[]} sources.gwtFiles - every gwt-*.md file
 * @param {{name:string, path:string}[]} sources.parsedSpecs - parsed spec methods
 * @param {{id:string, name:string, package:string, className:string, fields:object[]}[]} sources.commands
 * @param {{id:string, package:string, className:string, name:string}[]} sources.readModels
 * @returns {{pendingRules:{rule:string, command:object|null}[], pendingScenarios:{scenario:string, file:string, readModel:object|null}[]}}
 */
export function pendingWork({ businessRulesRaw, gwtFiles, parsedSpecs, commands, readModels }) {
  const satisfied = satisfiedBySlice(parsedSpecs);
  const readModelById = new Map((readModels || []).map((r) => [r.id, r]));

  const pendingRules = parseBusinessRules(businessRulesRaw)
    .map((rule) => ({ rule, command: ruleCommand(rule, commands) }))
    .filter(({ rule, command }) => {
      if (!command) return true; // cannot decide -> keep pending, prompt names it
      const slice = command.package.split('.').pop();
      const inSlice = satisfied.get(slice) || new Set();
      return !inSlice.has(rule);
    });

  const pendingScenarios = [];
  for (const { name, content } of gwtFiles) {
    // gwt-<readmodel>.md -> read model id from the filename.
    const rmId = name.replace(/^gwt-/, '').replace(/\.md$/, '');
    const readModel = readModelById.get(rmId) || null;
    for (const scenario of parseGwtScenarios(content)) {
      let done = false;
      if (readModel) {
        const slice = readModel.package.split('.').pop();
        const inSlice = satisfied.get(slice) || new Set();
        done = inSlice.has(scenario);
      } else {
        // No known read model (gwt file with no match): fall back to a
        // tree-wide lookup so an unmodeled file still isn't lost.
        done = [...satisfied.values()].some((s) => s.has(scenario));
      }
      if (!done) pendingScenarios.push({ scenario, file: name, readModel });
    }
  }

  return { pendingRules, pendingScenarios };
}

/**
 * Render the pending-work queue as ready-to-execute prompts, scenarios first
 * (they name their own target read model) then business rules. Each prompt
 * carries the exact spec path so the agent never has to guess where the test
 * lives.
 */
export function buildQueue({ pendingScenarios, pendingRules }, { groovyRoot, base } = {}) {
  return [
    ...pendingScenarios.map((s) => {
      const sub = s.readModel
        ? { slice: s.readModel.package.split('.').pop(), specClass: specClassOf(s.readModel.id) }
        : null;
      const where = sub
        ? specPath(groovyRoot, base, sub.slice, sub.specClass)
        : `${groovyRoot}/<slice>/<Spec>Spec.groovy  (read model for ${s.file} not found — put the test in the read model's own slice)`;
      return {
        kind: 'gwt-scenario',
        detail: s,
        prompt:
          `Delegate to backend-implement: implement the scenario "${s.scenario}" ` +
          `from <docs>/${s.file}. Write the Spock spec at \`${where}\` (the read model's ` +
          `own slice; the test method is named after the scenario verbatim), watch it fail, ` +
          `then implement the decision in the decider the failure names.`,
      };
    }),
    ...pendingRules.map((r) => {
      const sub = r.command
        ? { slice: r.command.package.split('.').pop(), specClass: specClassOf(r.command.id) }
        : null;
      const where = sub
        ? specPath(groovyRoot, base, sub.slice, sub.specClass)
        : `${groovyRoot}/<command-slice>/<Command>Spec.groovy  (could not map "${r.rule}" to a command unambiguously — pick the command whose Decider it constrains, name the spec after the rule verbatim, and place it in that command's slice)`;
      return {
        kind: 'business-rule',
        detail: r,
        prompt:
          `Delegate to backend-implement: enforce the business rule "${r.rule}" verbatim. ` +
          `Write the Spock spec at \`${where}\` (the command's own slice; the test method ` +
          `is named after the rule verbatim), then add the guard to that command's ` +
          `Decider.check().`,
      };
    }),
  ];
}
