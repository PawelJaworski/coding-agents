// GENERATE_GWTS — turn each pending GWT scenario / business rule into working
// behavior. One queue item at a time, test-first.
//
// This step emits no files: it scans `gwt-*.md` and `business-rules-raw.md`
// against the Spock specs already on disk and reports what is still unimplemented.
// The scenario IS written down as a test — see ../README.md — so nothing here
// ever asks for a new `.md`.
//
// Public surface of this step package: `GWTStep` (what the step machine needs —
// note it owns its own prompt, since "test-first, Ability-only" is step
// knowledge) and `GWTPlugin` (what the scanner registry needs).

import fs from 'node:fs';
import path from 'node:path';
import { pendingWork, buildQueue, parseSpecNames } from './queue.js';

/** Recursively collect every file path under a directory. */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

/**
 * The one convention an implementing agent gets wrong and that silently keeps
 * the item pending forever: `codegen --next` matches a scenario/rule to "done"
 * by an exact spec method name, and parseSpecNames only recognizes
 * double-quoted names (`def "..."`).
 */
export function nameQuotesHint(name) {
  return (
    `Write the Spock method name DOUBLE-quoted and verbatim: def "${name}"(). ` +
    'parseSpecNames matches only `def "..."`; a single-quoted name keeps this item pending forever.'
  );
}

export const GWTStep = {
  id: 'GENERATE_GWTS',
  category: 'gwt',
  // Test data is filled before scenarios: a scenario spec overrides only what
  // it cares about, so the defaults it relies on must already exist.
  after: ['GENERATE_COMMANDS', 'GENERATE_READ_MODELS', 'GENERATE_TEST_DATA'],

  render: (item, index, total) => {
    const left = total - index - 1;
    const label = item.kind === 'business-rule' ? 'rule' : 'scenario';
    return [
      `GENERATE_GWTS — item ${index + 1}/${total}`,
      '',
      `  ${label}: "${item.name}"`,
      `  source:   <docs>/${item.source}`,
      `  spec:     ${item.spec}`,
      '',
      'Test first: transcribe the name VERBATIM, run it, get a loud failure, then write',
      'the minimal production logic in the handler, aggregate, or projection decider the failure names.',
      'The spec reaches production only through *Ability — never `new` a handler, projector,',
      'repository, entity or event. Write exactly this shape (names come from the generated',
      '*Ability interfaces; `codegen --check` fails on any `new` of a production type in a spec):',
      '',
      '    package <spec package>',
      '',
      '    import <AggregateIdSequenceAbility FQCN>',
      '    import <CommandAbility FQCN>',
      '    import spock.lang.Specification',
      '',
      '    class <Name>Spec extends Specification',
      '            implements <CommandAbility>, <ReadModelProjectorAbility>, AggregateIdSequenceAbility {',
      '',
      '        def setup() {',
      '            reset_aggregate_id_sequence()',
      '            reset_event_stream()',
      '        }',
      '',
      '        def "<scenario name verbatim>"() {',
      '            given:',
      '            <command_dsl> { it.<field>(TEST_<FIELD>) }',
      '',
      '            when:',
      '            ...',
      '',
      '            then:',
      '            expect_<read_model> { rows -> rows.size() == 1 && rows[0].<field>() == <expected> }',
      '        }',
      '    }',
      '',
      'Mix in every ability whose DSL the scenario touches — the reset_* hooks live on the',
      'abilities as well. If green only happens after adding logic to a test-only',
      '*Ability double (an anonymous override, extra wiring) instead of production code, that is',
      'scope creep on the wrong side: the double may never stand in for logic production lacks.',
      '',
      ...(item.hints ?? []).map((h) => `  ${h}`),
      '',
      `Touch nothing else. ${left > 0 ? `${left} item(s) left in this step.` : 'Last item.'}`,
    ].join('\n');
  },
};

export const GWTPlugin = {
  id: 'gwt',
  scanner: {
    id: 'gwt',
    scan: (model, ctx) => {
      const { projectRoot, modelDir, groovyTestRoot, basePackage } = ctx;

      const businessRulesPath = path.join(modelDir, 'business-rules-raw.md');
      const businessRulesRaw = fs.existsSync(businessRulesPath)
        ? fs.readFileSync(businessRulesPath, 'utf8')
        : '';

      const gwtFiles = walk(modelDir)
        .filter((f) => /^gwt-.*\.md$/.test(path.basename(f)))
        .map((f) => ({ name: path.basename(f), content: fs.readFileSync(f, 'utf8') }));

      const parsedSpecs = walk(groovyTestRoot)
        .filter((f) => f.endsWith('.groovy'))
        .flatMap((f) => parseSpecNames(fs.readFileSync(f, 'utf8'), path.relative(projectRoot, f)));

      const pending = pendingWork({
        businessRulesRaw,
        gwtFiles,
        parsedSpecs,
        commands: model.commands,
        readModels: model.readModels,
      });

      const queue = buildQueue(pending, { groovyRoot: groovyTestRoot, base: basePackage });

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
    step: GWTStep,
  },
};