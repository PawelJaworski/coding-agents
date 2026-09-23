// Deterministic name derivation. This file replaces the prose naming rules that
// used to live in backend-plan/SKILL.md. It is a pure function of the model —
// nothing here reads the filesystem, so "does class X exist?" is decidable from
// the model alone and no code index is ever needed.

const words = (s) => String(s).trim().toLowerCase().split(/[\s\-_]+/).filter(Boolean);

const pascal = (s) => words(s).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
// Capitalize the first letter of an already-camel name (policyHolder -> PolicyHolder).
// Unlike pascal(), it does NOT split on words: a foo-bar id would come through as a
// single token, which is correct for turning a generated camel field name into a
// Lombok getter name.
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const camel = (s) => {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
};
const screamingSnake = (s) => words(s).join('_').toUpperCase();
// database column naming: camelCase -> snake_case (policyHolder -> policy_holder)
const snake = (s) =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
// slice package: kebab collapses to a single lowercase segment (issue-policy -> issuepolicy)
const slicePackage = (s) => words(s).join('');
// package segment from a FREE-FORM name (a System name: is human prose, not an
// id): "Underwriter Portal" -> "underwriterportal", "ACME Corp." -> "acmecorp".
// Anything that is not a-z0-9 is stripped so the result is always a legal
// Java package segment.
const systemPackage = (s) =>
  words(s)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .join('');

// Aggregate identity type. Every generated reference to an aggregate id —
// event records, handlers, aggregates, read models, entities, test DSLs —
// reads from here. Flip `javaType` back to 'UUID' (and restore the
// 'java.util.UUID' import where the templates expect it) to revert.
// `Long` lives in java.lang, so `imports` is empty.
export const AGGREGATE_ID = {
  javaType: 'Long',
  imports: [],
  tsType: 'number',
  // The handler calls this collaborator method to allocate a new id.
  sequenceField: 'aggregateIdSequence',
  sequenceClass: 'AggregateIdSequence',
  sequenceAbility: 'AggregateIdSequenceAbility',
  generateExpr: 'aggregateIdSequence.nextId()',
};

const naming = {
  words,
  pascal,
  cap,
  camel,
  screamingSnake,
  snake,
  slicePackage,
  systemPackage,

  command: (base, id) => ({
    className: `${pascal(id)}Cmd`,
    package: `${base}.${slicePackage(id)}`,
    handlerClassName: `${pascal(id)}Handler`,
    abilityClassName: `${pascal(id)}Ability`,
    postMapping: id,
    dslMethod: words(id).join('_'),
  }),

  // One plain aggregate state type per <aggregate>:Id name in events.md.
  aggregate: (base, name) => ({
    className: `${pascal(name)}Aggregate`,
    package: `${base}.domain`,
  }),

  event: (base, id) => ({
    className: `${pascal(id)}Event`,
    package: `${base}.domain.events`,
    typeEnum: screamingSnake(id),
    serdeClassName: `${pascal(id)}EventSerdeWrapper`,
    serdePackage: `${base}.infrastructure`,
  }),

  // `keyed` picks the persisting variant: an extra entity + repository pair, and a
  // collection endpoint (no {aggregateId} path variable, since it spans aggregates).
  readModel: (base, id, { keyed = false } = {}) => ({
    className: pascal(id),
    package: `${base}.${slicePackage(id)}`,
    projectorClassName: `${pascal(id)}Projector`,
    deciderClassName: `${pascal(id)}ProjectionDecider`,
    abilityClassName: `${pascal(id)}ProjectorAbility`,
    getterMethod: `get${pascal(id)}`,
    getMapping: keyed ? id : `${id}/{aggregateId}`,
    dslMethod: `expect_${words(id).join('_')}`,
    // persisting-only names
    entityClassName: `${pascal(id)}Entity`,
    idClassName: `${pascal(id)}Key`,
    repositoryClassName: `${pascal(id)}Repository`,
    jpaRepositoryClassName: `${pascal(id)}JpaRepository`,
    inMemoryRepositoryClassName: `${pascal(id)}InMemoryRepository`,
    // distinct from EventStreamAbility.REPOSITORY, which this ability inherits
    repositoryConstant: `${screamingSnake(id)}_REPOSITORY`,
    tableName: words(id).join('_'),
  }),

  valueObject: (base, name) => ({
    className: pascal(name),
    package: `${base}.domain`,
  }),

  // Inbound contract of a system we don't own (external-events.md). NOT a
  // DomainEvent — never appended to the stream; a translator maps it to a
  // command and stops there. Lives in its own package NAMED AFTER the
  // external system (`System name:`), one slice per system, so contracts from
  // different systems never share a type namespace.
  externalEvent: (base, id, systemName = 'External') => ({
    className: `${pascal(id)}External`,
    package: `${base}.${systemPackage(systemName) || 'external'}`,
  }),

  // A translator is an ingress adapter (Translation Pattern): it turns an
  // external-event payload into a command and hands it to CommandHandler.
  // `Type:` on the translator selects the transport (`rest` | `kafka` | anything
  // else -> no transport, plain @Component).
  translator: (base, id) => ({
    className: `${pascal(id)}Translator`,
    package: `${base}.${slicePackage(id)}`,
  }),

  // Shared test-data interface (TestDataPlugin): one per project, in the test
  // source set, extended by every command ability. One namespace on purpose —
  // a spec implementing abilities from several slices must never hit an
  // ambiguous constant.
  testDataAbility: (base) => ({
    package: `${base}.testdata`,
    className: 'TestDataAbility',
  }),
  // constant for a command field's default: policy holder -> TEST_POLICY_HOLDER
  testDataConstant: (label) => `TEST_${screamingSnake(label)}`,
  // the per-command default-builder method a generated *Ability DSL calls:
  // IssuePolicyCmd -> defaultIssuePolicyCmd()
  defaultBuilderMethod: (commandClassName) => `default${commandClassName}`,

  // Translator call-site names, derived only (never looked up):
  //   handler field  IssuePolicyHandler -> issuePolicyHandler
  //   map method     issue-policy       -> toIssuePolicyCmd
  //   entry method   application-received -> onApplicationReceived
  //   parse method   application-received -> parseApplicationReceived
  // `cap`'s inverse (NOT camel(), which re-splits words and would flatten an
  // already-PascalCase class name into one lowercase token).
  handlerField: (handlerClassName) => (handlerClassName ? handlerClassName[0].toLowerCase() + handlerClassName.slice(1) : handlerClassName),
  mapMethod: (commandId) => `to${pascal(commandId)}Cmd`,
  entryMethod: (externalEventId) => `on${pascal(externalEventId)}`,
  parseMethod: (externalEventId) => `parse${pascal(externalEventId)}`,

  field: (name) => camel(name),

  // src path for a fully qualified class
  path: (root, pkg, className, ext = 'java') =>
    `${root}/${pkg.split('.').join('/')}/${className}.${ext}`,
};

export default naming;
