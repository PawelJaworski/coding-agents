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

const naming = {
  words,
  pascal,
  cap,
  camel,
  screamingSnake,
  snake,
  slicePackage,

  command: (base, id) => ({
    className: `${pascal(id)}Cmd`,
    package: `${base}.${slicePackage(id)}`,
    handlerClassName: `${pascal(id)}Handler`,
    deciderClassName: `${pascal(id)}Decider`,
    abilityClassName: `${pascal(id)}Ability`,
    postMapping: id,
    dslMethod: words(id).join('_'),
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

  field: (name) => camel(name),

  // src path for a fully qualified class
  path: (root, pkg, className, ext = 'java') =>
    `${root}/${pkg.split('.').join('/')}/${className}.${ext}`,
};

export default naming;
