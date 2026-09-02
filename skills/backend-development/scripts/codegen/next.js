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
 * Spock spec method names: `def "text"() {`. This is exactly how
 * backend-implement names a spec — after the GWT heading or the rule's own
 * words, verbatim — so a rule/scenario with no spec of the same name has not
 * been implemented yet.
 */
export function parseSpecNames(groovyContent) {
  return [...groovyContent.matchAll(/def\s+"([^"]+)"\s*\(/g)].map((m) => m[1]);
}

/**
 * Cross-reference the model's rules and scenarios against existing spec names
 * to build the queue of unimplemented work.
 *
 * @param {object} sources
 * @param {string} sources.businessRulesRaw - business-rules-raw.md content, or ''
 * @param {{name: string, content: string}[]} sources.gwtFiles - every gwt-*.md file
 * @param {string[]} sources.specContents - every .groovy file's content under the
 *   Groovy test source root
 * @returns {{pendingRules: string[], pendingScenarios: {scenario: string, file: string}[]}}
 */
export function pendingWork({ businessRulesRaw, gwtFiles, specContents }) {
  const specNames = new Set(specContents.flatMap(parseSpecNames));

  const pendingRules = parseBusinessRules(businessRulesRaw).filter((r) => !specNames.has(r));

  const pendingScenarios = [];
  for (const { name, content } of gwtFiles) {
    for (const scenario of parseGwtScenarios(content)) {
      if (!specNames.has(scenario)) pendingScenarios.push({ scenario, file: name });
    }
  }

  return { pendingRules, pendingScenarios };
}

/**
 * Render the pending-work queue as ready-to-execute prompts, scenarios first
 * (they name their own target read model) then business rules.
 */
export function buildQueue({ pendingScenarios, pendingRules }) {
  return [
    ...pendingScenarios.map((s) => ({
      kind: 'gwt-scenario',
      detail: s,
      prompt:
        `Delegate to backend-implement: implement the scenario "${s.scenario}" ` +
        `from <docs>/${s.file}. Write the Spock spec named after the scenario, watch ` +
        `it fail, then implement the decision in the decider the failure names.`,
    })),
    ...pendingRules.map((r) => ({
      kind: 'business-rule',
      detail: r,
      prompt:
        `Delegate to backend-implement: enforce the business rule "${r}" verbatim. ` +
        `Find its command in <docs>/commands.md by aggregate and behavior, write a spec ` +
        `named after the rule, then add the guard to that command's Decider.check().`,
    })),
  ];
}
