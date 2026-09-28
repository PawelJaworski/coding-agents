// GENERATE_READ_MODELS: the read model record, its projection and — for
// <aggregate>:Key / <aggregate>:RowKey — the entity, composite key and
// repositories that go with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmitContext } from '../../core/context.js';
import { resolveArg } from '../../emit-kit/index.js';
import {
  projector,
  readModelEntity,
  readModelKey,
  readModelRepository,
  readModelJpaRepository,
  readModelInMemoryRepository,
  persistingProjector,
  persistingProjectorAbility,
} from './index.js';

const BASE = 'pl.pjaworski.insurance_company';
const CTX = createEmitContext({ basePackage: BASE });

// --- read model entity: embeddable value objects become flattened columns ------

const VA_ENT = 'pl.pjaworski.insurance_company.policylist';

const vaRm = () => ({
  id: 'policy-list',
  className: 'PolicyList',
  package: VA_ENT,
  getterMethod: 'getPolicyList',
  getMapping: 'policy-list',
  collection: true,
  dslMethod: 'expect_policy_list',
  entityClassName: 'PolicyListEntity',
  idClassName: 'PolicyListKey',
  projectorClassName: 'PolicyListProjector',
  abilityClassName: 'PolicyListProjectorAbility',
  repositoryClassName: 'PolicyListRepository',
  inMemoryRepositoryClassName: 'PolicyListInMemoryRepository',
  repositoryConstant: 'POLICY_LIST_REPOSITORY',
  tableName: 'policy_list',
  subscribes: ['policy-issued'],
  keyFields: [],
  fields: [
    {
      name: 'policyHolder',
      label: 'policy holder',
      javaType: 'PolicyHolder',
      imports: ['pl.pjaworski.insurance_company.domain.PolicyHolder'],
      valueObject: { className: 'PolicyHolder', package: 'pl.pjaworski.insurance_company.domain' },
      embeds: true,
      attrs: [
        { name: 'name', javaType: 'String' },
        { name: 'surname', javaType: 'String' },
      ],
      searchable: true,
    },
    { name: 'policyNumber', label: 'policy number', javaType: 'String', imports: [], searchable: true },
    {
      name: 'coverage',
      label: 'coverage',
      javaType: 'PolicyCoverage',
      imports: ['pl.pjaworski.insurance_company.domain.PolicyCoverage'],
      valueObject: { className: 'PolicyCoverage', package: 'pl.pjaworski.insurance_company.domain' },
      embeds: false,
      attrs: [],
    },
  ],
});

test('readModelEntity embeds scalar value objects via @Embedded + @AttributeOverrides', () => {
  const ent = readModelEntity(vaRm());
  assert.match(ent.content, /@Embedded\s+@AttributeOverrides\(\{[^}]*policy_holder_name/s);
  assert.match(ent.content, /@AttributeOverride\(name = "name", column = @Column\(name = "policy_holder_name"\)\)/);
  assert.match(ent.content, /@AttributeOverride\(name = "surname", column = @Column\(name = "policy_holder_surname"\)\)/);
  assert.match(ent.content, /import jakarta.persistence.AttributeOverride;/);
  assert.match(ent.content, /import jakarta.persistence.Embedded;/);
});

test('readModelEntity keeps a list-bearing value object as JSON, not embedded', () => {
  const ent = readModelEntity(vaRm());
  assert.match(ent.content, /@JdbcTypeCode\(SqlTypes\.JSON\)\s+private PolicyCoverage coverage;/);
  assert.match(ent.content, /import org.hibernate.annotations.JdbcTypeCode;/);
  assert.doesNotMatch(ent.content, /@Embedded\s+private PolicyCoverage coverage;/);
});

// --- persisting projector GET: server-side search on the list endpoint ----------

test('persistingProjector delegates search to the repository, no in-memory filter', () => {
  const eventsById = new Map([
    ['policy-issued', { id: 'policy-issued', name: 'Policy Issued', aggregate: 'policy', fields: [
      { name: 'policyHolder', javaType: 'PolicyHolder' },
      { name: 'policyNumber', javaType: 'String' },
    ] }],
  ]);
  const p = persistingProjector(vaRm(), eventsById, CTX);
  assert.match(p.content, /getPolicyList\(@RequestParam Map<String, String> search\)/);
  // Server-side: the projector asks the repository to run the search, never findAll()+filter.
  assert.match(p.content, /return repository\.findAllBySearch\(search\)\.stream\(\)/);
  assert.doesNotMatch(p.content, /\.filter\(e -> matches/);
  assert.doesNotMatch(p.content, /repository\.findAll\(\)/);
});

test('projectionDecider generates a throwing matches<Field> stub for a search-only field', () => {
  const rm = { ...vaRm(), deciderClassName: 'PolicyListProjectionDecider', searchOnlyFields: [{ label: 'policy coverage risk', name: 'policyCoverageRisk', searchOnly: true }] };
  const eventsById = new Map([
    ['policy-issued', { id: 'policy-issued', name: 'Policy Issued', aggregate: 'policy', fields: [
      { name: 'policyHolder', javaType: 'PolicyHolder' },
      { name: 'policyNumber', javaType: 'String' },
    ] }],
  ]);
  const p = persistingProjector(rm, eventsById, CTX);
  const deciderCollaborator = p.collaborators.find((c) => c.fieldName === 'decider');
  const d = deciderCollaborator.scaffold();
  assert.match(d.content, /public boolean matchesPolicyCoverageRisk\(String value, PolicyList entity\)/);
  assert.match(d.content, /UnsupportedOperationException/);
  assert.match(d.content, /\\"policy coverage risk\?\?\\" on read model 'policy-list' is a search criterion with no implementation yet/);
});

test('persistingProjector applies a post-query Java filter for a "??" field, delegating to the decider', () => {
  const rm = { ...vaRm(), deciderClassName: 'PolicyListProjectionDecider', searchOnlyFields: [{ label: 'policy coverage risk', name: 'policyCoverageRisk', searchOnly: true }] };
  const eventsById = new Map([
    ['policy-issued', { id: 'policy-issued', name: 'Policy Issued', aggregate: 'policy', fields: [
      { name: 'policyHolder', javaType: 'PolicyHolder' },
      { name: 'policyNumber', javaType: 'String' },
    ] }],
  ]);
  const p = persistingProjector(rm, eventsById, CTX);
  // The DB-level search call is unchanged; the "??" field is filtered afterward.
  assert.match(p.content, /repository\.findAllBySearch\(search\)\.stream\(\)/);
  assert.match(p.content, /\.filter\(r -> \{/);
  assert.match(p.content, /String v = search\.get\("policyCoverageRisk"\);/);
  assert.match(p.content, /decider\.matchesPolicyCoverageRisk\(v, r\)/);
  // The decider collaborator must now be wired in, even though no [bracketed]
  // field ever delegates a projected VALUE to it.
  assert.ok(p.collaborators.some((c) => c.fieldName === 'decider'));
});

test('persistingProjectorAbility exposes a search-capable DSL overload', () => {
  const a = persistingProjectorAbility(vaRm(), CTX, []);
  assert.match(a.content, /getPolicyList\(Map\.of\(\)\)/);
  assert.match(a.content, /expect_policy_list\(Map<String, String> search, Predicate<List<PolicyList>> testCase\)/);
  assert.match(a.content, /import java.util.Map;/);
});

// --- server-side repository search ---------------------------------------------

test('repository interface exposes findAllBySearch', () => {
  const r = readModelRepository(vaRm());
  assert.match(r.content, /List<PolicyListEntity> findAllBySearch\(Map<String, String> search\);/);
  assert.match(r.content, /import java.util.Map;/);
});

test('JPA repository searches server-side via Specification per field', () => {
  const j = readModelJpaRepository(vaRm());
  assert.match(j.content, /JpaSpecificationExecutor<PolicyListEntity>/);
  assert.match(j.content, /default List<PolicyListEntity> findAllBySearch\(Map<String, String> search\)/);
  assert.match(j.content, /cb\.like\(cb\.lower\(root\.get\("policyHolder"\)\.get\("name"\)\), "%" \+ search\.get\("policyHolder\.name"\)\.toLowerCase\(\) \+ "%"\)/);
  assert.match(j.content, /cb\.like\(cb\.lower\(root\.get\("policyHolder"\)\.get\("surname"\)\)/);
  assert.match(j.content, /cb\.like\(cb\.lower\(root\.get\("policyNumber"\)\)/);
  assert.match(j.content, /import org.springframework.data.jpa.domain.Specification;/);
  assert.match(j.content, /import org.springframework.data.jpa.repository.JpaSpecificationExecutor;/);
});

test('in-memory repository search mirrors the server-side semantics', () => {
  const i = readModelInMemoryRepository(vaRm());
  assert.match(i.content, /findAllBySearch\(Map<String, String> search\)/);
  assert.match(i.content, /case "policyHolder\.name" ->/);
  assert.match(i.content, /e\.getPolicyHolder\(\)\.name\(\)\.toLowerCase\(\)\.contains\(value\.toLowerCase\(\)\)/);
  assert.match(i.content, /case "policyNumber" ->/);
});
// --- field-level :Key composite key --------------------------------------------

const keyedRm = () => ({
  id: 'policy-list',
  className: 'PolicyList',
  package: VA_ENT,
  getterMethod: 'getPolicyList',
  getMapping: 'policy-list',
  collection: true,
  dslMethod: 'expect_policy_list',
  entityClassName: 'PolicyListEntity',
  idClassName: 'PolicyListKey',
  projectorClassName: 'PolicyListProjector',
  abilityClassName: 'PolicyListProjectorAbility',
  repositoryClassName: 'PolicyListRepository',
  jpaRepositoryClassName: 'PolicyListJpaRepository',
  inMemoryRepositoryClassName: 'PolicyListInMemoryRepository',
  repositoryConstant: 'POLICY_LIST_REPOSITORY',
  tableName: 'policy_list',
  subscribes: ['policy-issued'],
  fields: [
    { name: 'policyNumber', label: 'policy number', javaType: 'String', imports: [], key: true },
    {
      name: 'policyHolder',
      label: 'policy holder',
      javaType: 'PolicyHolder',
      imports: ['pl.pjaworski.insurance_company.domain.PolicyHolder'],
      valueObject: { className: 'PolicyHolder', package: 'pl.pjaworski.insurance_company.domain' },
      embeds: true,
      attrs: [
        { name: 'name', javaType: 'String' },
        { name: 'surname', javaType: 'String' },
      ],
    },
  ],
  keyFields: [
    { name: 'policyNumber', label: 'policy number', javaType: 'String', imports: [], key: true },
  ],
});

test('readModelKey emits @Embeddable record with key fields', () => {
  const keyClass = readModelKey(keyedRm());
  assert.equal(keyClass.className, 'PolicyListKey');
  assert.match(keyClass.content, /@Embeddable\s+public record PolicyListKey\(\s+String policyNumber\)/);
});

test('readModelEntity uses @EmbeddedId PolicyListKey when keyFields present', () => {
  const ent = readModelEntity(keyedRm());
  assert.match(ent.content, /@EmbeddedId\s+private PolicyListKey id;/);
  assert.doesNotMatch(ent.content, /Long aggregateId/);
  assert.match(ent.content, /return new PolicyList\(id\.policyNumber\(\), policyHolder\);/);
});

test('persistingProjector saves entity with composite key when keyFields present', () => {
  const eventsById = new Map([
    ['policy-issued', {
      id: 'policy-issued',
      name: 'Policy Issued',
      package: 'pl.pjaworski.insurance_company.domain.events',
      className: 'PolicyIssuedEvent',
      typeEnum: 'POLICY_ISSUED',
      fields: [
        { name: 'policyHolder', javaType: 'PolicyHolder' },
        { name: 'policyNumber', javaType: 'String' },
      ],
    }],
  ]);
  const p = persistingProjector(keyedRm(), eventsById, CTX);
  assert.match(p.content, /repository\.save\(new PolicyListEntity\(new PolicyListKey\(projected\.policyNumber\(\)\), projected\.policyHolder\(\)\)\);/);
  // A non-identity key field has no accessor on the generic DomainEvent project()
  // receives — dispatch pattern-matches the concrete event class directly, so the
  // lookup key is built from the typed event in its own switch case, with no cast
  // and no hydrate().
  assert.match(p.content, /case PolicyIssuedEvent evt ->/);
  assert.match(p.content, /repository\.findById\(new PolicyListKey\(evt\.policyNumber\(\)\)\)/);
  assert.doesNotMatch(p.content, /\(\(PolicyIssuedEvent\) event\)/);
  assert.doesNotMatch(p.content, /hydrate\(/);
  assert.doesNotMatch(p.content, /event\.aggregateId\(\)/);
});

test('a persisting projector is a per-event mapper, never a stream-rebuild state projector', () => {
  const eventsById = new Map([
    ['policy-issued', {
      id: 'policy-issued',
      name: 'Policy Issued',
      package: 'pl.pjaworski.insurance_company.domain.events',
      className: 'PolicyIssuedEvent',
      typeEnum: 'POLICY_ISSUED',
      fields: [
        { name: 'policyHolder', javaType: 'PolicyHolder' },
        { name: 'policyNumber', javaType: 'String' },
      ],
    }],
  ]);
  const p = persistingProjector(keyedRm(), eventsById, CTX);
  // No whole-state machinery: the class does not implement StateProjector, hydrate
  // is never called, and apply() is a plain per-event mapper (not an @Override).
  assert.match(p.content, /public class PolicyListProjector implements PersistingProjector/);
  assert.doesNotMatch(p.content, /StateProjector/);
  assert.doesNotMatch(p.content, /hydrate\(/);
  assert.doesNotMatch(p.content, /@Override\s+public PolicyList apply/);
  assert.match(p.content, /project\(DomainEvent event\)/);
  assert.match(p.content, /case PolicyIssuedEvent evt ->/);
  assert.match(p.content, /default -> \{/);
  // A missing row is a create: apply() must run even when the lookup is empty, so
  // the row is never silently dropped on the first event for its key.
  assert.match(p.content, /\.orElse\(null\);/);
  assert.match(p.content, /apply\(state, evt\);/);
});


test('repositories use PolicyListKey as ID type when keyFields present', () => {
  const repo = readModelRepository(keyedRm());
  assert.match(repo.content, /Optional<PolicyListEntity> findById\(PolicyListKey id\);/);

  const jpa = readModelJpaRepository(keyedRm());
  assert.match(jpa.content, /JpaRepository<PolicyListEntity, PolicyListKey>/);

  const mem = readModelInMemoryRepository(keyedRm());
  assert.match(mem.content, /Map<PolicyListKey, PolicyListEntity> entities/);
  assert.match(mem.content, /entities\.put\(entity\.getId\(\), entity\);/);
});

// `:Key` on a whole value-object field (e.g. `* policy holder:Key`) makes every one
// of its attributes part of the composite key — not just the aggregate id. Distinct
// from the scalar-field case above: the embedded key component holds `f.attrs`, not
// a single scalar, and the record component must carry NO access modifier (a Java
// record component with `private` is a compile error caught by nothing but `javac`,
// which is exactly how this bug first shipped).
const embeddedKeyedRm = () => ({
  id: 'insured-policies',
  className: 'InsuredPolicies',
  package: VA_ENT,
  getterMethod: 'getInsuredPolicies',
  getMapping: 'insured-policies',
  collection: true,
  dslMethod: 'expect_insured_policies',
  entityClassName: 'InsuredPoliciesEntity',
  idClassName: 'InsuredPoliciesKey',
  projectorClassName: 'InsuredPoliciesProjector',
  abilityClassName: 'InsuredPoliciesProjectorAbility',
  repositoryClassName: 'InsuredPoliciesRepository',
  jpaRepositoryClassName: 'InsuredPoliciesJpaRepository',
  inMemoryRepositoryClassName: 'InsuredPoliciesInMemoryRepository',
  repositoryConstant: 'INSURED_POLICIES_REPOSITORY',
  tableName: 'insured_policies',
  subscribes: ['policy-issued'],
  fields: [
    {
      name: 'policyKey',
      label: 'policy key',
      identity: true,
      javaType: 'Long',
      imports: [],
    },
    {
      name: 'policyHolder',
      label: 'policy holder',
      javaType: 'PolicyHolder',
      imports: ['pl.pjaworski.insurance_company.domain.PolicyHolder'],
      valueObject: { className: 'PolicyHolder', package: 'pl.pjaworski.insurance_company.domain' },
      embeds: true,
      key: true,
      attrs: [
        { name: 'name', javaType: 'String' },
        { name: 'surname', javaType: 'String' },
      ],
    },
    { name: 'noOfPolicies', label: 'no of policies', javaType: 'String', imports: [], bracketed: true },
  ],
  keyFields: [
    {
      name: 'policyHolder',
      label: 'policy holder',
      javaType: 'PolicyHolder',
      imports: ['pl.pjaworski.insurance_company.domain.PolicyHolder'],
      valueObject: { className: 'PolicyHolder', package: 'pl.pjaworski.insurance_company.domain' },
      embeds: true,
      key: true,
      attrs: [
        { name: 'name', javaType: 'String' },
        { name: 'surname', javaType: 'String' },
      ],
    },
  ],
});

test('readModelKey embeds a whole value-object key field with no modifier on the record component', () => {
  const keyClass = readModelKey(embeddedKeyedRm());
  assert.equal(keyClass.className, 'InsuredPoliciesKey');
  // A record component must be bare — `private` here is a compile error (javac:
  // "record components cannot have modifiers").
  assert.doesNotMatch(keyClass.content, /private PolicyHolder policyHolder/);
  assert.match(keyClass.content, /@Embeddable\s+public record InsuredPoliciesKey\(\s+@Embedded/);
  assert.match(keyClass.content, /PolicyHolder policyHolder\)/);
  assert.match(keyClass.content, /@AttributeOverride\(name = "name", column = @Column\(name = "policy_holder_name"\)\)/);
  assert.match(keyClass.content, /@AttributeOverride\(name = "surname", column = @Column\(name = "policy_holder_surname"\)\)/);
});

test('readModelEntity keeps a non-key identity field as a plain column alongside an embedded-object @EmbeddedId', () => {
  const ent = readModelEntity(embeddedKeyedRm());
  assert.match(ent.content, /@EmbeddedId\s+private InsuredPoliciesKey id;/);
  assert.match(ent.content, /private Long policyKey;/);
  assert.doesNotMatch(ent.content, /private PolicyHolder policyHolder;/); // lives in the id, not as its own column
  assert.match(ent.content, /return new InsuredPolicies\(policyKey, id\.policyHolder\(\), noOfPolicies\);/);
});

test('persistingProjector looks state up by the embedded value-object key, not the aggregate id — so two events for the same holder merge into one row', () => {
  const eventsById = new Map([
    ['policy-issued', {
      id: 'policy-issued',
      name: 'Policy Issued',
      package: 'pl.pjaworski.insurance_company.domain.events',
      className: 'PolicyIssuedEvent',
      typeEnum: 'POLICY_ISSUED',
      fields: [{ name: 'policyHolder', javaType: 'PolicyHolder' }],
    }],
  ]);
const p = persistingProjector(embeddedKeyedRm(), eventsById, CTX);
  // project(DomainEvent event) only has DomainEvent's own members (aggregateId())
  // available on `event` — the concrete event is bound by per-event pattern
  // dispatch, so `.policyHolder()` is callable on `evt` without a cast.
  assert.match(p.content, /case PolicyIssuedEvent evt ->/);
  assert.match(p.content, /repository\.findById\(new InsuredPoliciesKey\(evt\.policyHolder\(\)\)\)/);
  assert.doesNotMatch(p.content, /\(\(PolicyIssuedEvent\) event\)/);
  assert.doesNotMatch(p.content, /hydrate\(/);
  assert.match(p.content, /repository\.save\(new InsuredPoliciesEntity\(new InsuredPoliciesKey\(projected\.policyHolder\(\)\), projected\.policyKey\(\), projected\.noOfPolicies\(\)\)\)/);
  assert.doesNotMatch(p.content, /repository\.findById\(event\.aggregateId\(\)\)/);
});

// --- implicit identity attribute: sourced from event.aggregateId() --------------

const IDENTITY_FIELD = {
  name: 'policyKey',
  label: 'policy key',
  identity: true,
  javaType: 'Long',
  imports: [],
};

const issuedEvent = (fields) => ({
  id: 'policy-issued',
  name: 'Policy Issued',
  package: 'pl.pjaworski.insurance_company.domain.events',
  className: 'PolicyIssuedEvent',
  fields,
});

test('resolveArg sources the identity attribute from the aggregate id, never a name match', () => {
  const r = resolveArg(IDENTITY_FIELD, { sourceFields: [], sourceExpr: 'event' });
  assert.equal(r.expr, 'event.aggregateId()');
  assert.deepEqual(r.imports, []);
});

test('resolveArg refuses a list or nested mapping whose source shape differs', () => {
  assert.throws(
    () => resolveArg(
      { name: 'insuredParties', label: 'insured parties', list: true, children: [{ name: 'name', children: [] }] },
      {
        sourceFields: [
          { name: 'insuredParties', label: 'insured parties', list: true, children: [{ name: 'fullName', children: [] }] },
        ],
        sourceExpr: 'event',
      },
    ),
    /Unsupported structured-field mapping.*more detailed mapping prompt/,
  );
});

test('resolveArg delegates an unmappable structured field to the decider instead of throwing', () => {
  const field = { name: 'productName', label: 'product name', javaType: 'String', imports: [], unmappable: { reason: "field 'product name' cannot be derived automatically from 'product (list)'" } };
  const r = resolveArg(field, {
    sourceFields: [],
    sourceExpr: 'event',
    delegate: { fieldName: 'decider', args: 'state, event' },
  });
  assert.equal(r.delegated, true);
  assert.equal(r.expr, 'decider.productName(state, event)');
});

test('a projector for an unmappable structured read-model field generates but delegates to a throwing decider stub', () => {
  const rm = {
    id: 'stored-product',
    className: 'StoredProduct',
    package: 'pl.pjaworski.insurance_company.storedproduct',
    deciderClassName: 'StoredProductProjectionDecider',
    projectorClassName: 'StoredProductProjector',
    getterMethod: 'getStoredProduct',
    getMapping: 'stored-product/{aggregateId}',
    subscribes: ['products-added'],
    searchOnlyFields: [],
    keyFields: [],
    fields: [
      IDENTITY_FIELD,
      { name: 'productName', label: 'product name', javaType: 'String', imports: [], unmappable: { reason: "field 'product name' cannot be derived automatically from 'product (list)'" } },
    ],
  };
  const event = {
    id: 'products-added',
    name: 'Products Added',
    package: 'pl.pjaworski.insurance_company.domain.events',
    className: 'ProductsAddedEvent',
    fields: [{ name: 'productList', label: 'product', list: true, children: [{ name: 'name' }, { name: 'description' }], javaType: 'List<Product>', imports: [] }],
  };
  const p = projector(rm, new Map([['products-added', event]]), CTX);
  assert.match(p.content, /decider\.productName\(state, event\)/);
  const decider = p.collaborators.find((c) => c.scaffold).scaffold();
  assert.match(decider.content, /public String productName\(StoredProduct state, ProductsAddedEvent event\)/);
  assert.match(decider.content, /throw new UnsupportedOperationException\(/);
  assert.match(decider.content, /cannot be derived automatically from 'product \(list\)'/);
});

test('a persisting projector for an unresolvable named key delegates the key to a throwing decider stub and keeps generating', () => {
  const rm = {
    id: 'stored-product',
    className: 'StoredProduct',
    package: `${BASE}.storedproduct`,
    getterMethod: 'getStoredProduct',
    getMapping: 'stored-product',
    collection: true,
    dslMethod: 'expect_stored_product',
    entityClassName: 'StoredProductEntity',
    idClassName: 'StoredProductKey',
    abilityClassName: 'StoredProductProjectorAbility',
    repositoryClassName: 'StoredProductRepository',
    repositoryConstant: 'STORED_PRODUCT_REPOSITORY',
    tableName: 'stored_product',
    subscribes: ['products-added'],
    searchOnlyFields: [],
    keyFields: [
      { name: 'productCode', label: 'productCode', key: true, javaType: 'String', imports: [], unmappableKey: { reason: "key attribute 'productCode:Key' matches no declared field's value-object attribute" } },
    ],
    fields: [
      { name: 'productCode', label: 'product code', javaType: 'String', imports: [], unmappable: { reason: "field 'product code' cannot be derived automatically from 'product (list)'" } },
      { name: 'productName', label: 'product name', javaType: 'String', imports: [], unmappable: { reason: "field 'product name' cannot be derived automatically from 'product (list)'" } },
      { name: 'productDescription', label: 'product description', javaType: 'String', imports: [], unmappable: { reason: "field 'product description' cannot be derived automatically from 'product (list)'" } },
    ],
  };
  const event = {
    id: 'products-added',
    name: 'Products Added',
    package: `${BASE}.domain.events`,
    className: 'ProductsAddedEvent',
    typeEnum: 'PRODUCTS_ADDED',
    fields: [{ name: 'productList', label: 'product', list: true, children: [{ name: 'code' }, { name: 'name' }, { name: 'description' }], javaType: 'List<Product>', imports: [] }],
  };
  const p = persistingProjector(rm, new Map([['products-added', event]]), CTX);
  // apply: the composite key is delegated to the decider over the concrete event.
  assert.match(p.content, /new StoredProductKey\(decider\.productCode\(state, event\)\)/);
  // project(): per-event typed dispatch delegates the lookup key to the decider's
  // DomainEvent overload with the bound concrete event.
  assert.match(p.content, /case ProductsAddedEvent evt ->/);
  assert.match(p.content, /new StoredProductKey\(decider\.productCode\(evt\)\)/);
  // The decider collaborator must be wired even though no regular field delegates.
  assert.ok(p.collaborators.some((c) => c.fieldName === 'decider'));
  const decider = p.collaborators.find((c) => c.scaffold).scaffold();
  assert.match(decider.content, /public String productCode\(StoredProduct state, ProductsAddedEvent event\)/);
  assert.match(decider.content, /public String productCode\(DomainEvent event\)/);
  assert.match(decider.content, /throw new UnsupportedOperationException\(/);
  assert.match(decider.content, /productCode:Key/);
  assert.match(decider.content, /import .*\.eventstream\.DomainEvent;/);
  // The model's SAME-named flat field (* product code) is also unmappable — its
  // stub must NOT be emitted a second time, or the class has a duplicate overload.
  const stateEventOverload = 'public String productCode(StoredProduct state, ProductsAddedEvent event)';
  assert.equal(
    decider.content.split(stateEventOverload).length - 1,
    1,
    'the unmappableKey key stub and a same-named unmappable field must collapse to one overload',
  );
  assert.ok(
    !decider.content.includes("field 'product code' cannot be derived automatically"),
    'the same-named unmappable field stub must not be emitted separately',
  );
  // The composite id keeps a plain String component (fallback type), so the whole
  // slice compiles while the key decision throws at runtime until implemented.
  const key = readModelKey(rm);
  assert.match(key.content, /@Embeddable\s+public record StoredProductKey\(\s+String productCode\)/);
});

test('an on-demand projector folds the identity attribute from event.aggregateId()', () => {
  const rm = {
    id: 'policy-details',
    className: 'PolicyDetails',
    package: 'pl.pjaworski.insurance_company.policydetails',
    deciderClassName: 'PolicyDetailsProjectionDecider',
    projectorClassName: 'PolicyDetailsProjector',
    getterMethod: 'getPolicyDetails',
    getMapping: 'policy-details/{aggregateId}',
    subscribes: ['policy-issued'],
    keyFields: [],
    fields: [IDENTITY_FIELD, { name: 'policyHolder', label: 'policy holder', javaType: 'String', imports: [] }],
  };
  const p = projector(rm, new Map([['policy-issued', issuedEvent([{ name: 'policyHolder', javaType: 'String' }])]]), CTX);
  assert.match(p.content, /return new PolicyDetails\(\s+event\.aggregateId\(\),\s+event\.policyHolder\(\)/s);
});

test('a persisting projector saves the identity attribute from event.aggregateId()', () => {
  const rm = { ...vaRm(), fields: [IDENTITY_FIELD, ...vaRm().fields] };
  const p = persistingProjector(rm, new Map([['policy-issued', issuedEvent([{ name: 'policyHolder', javaType: 'PolicyHolder' }, { name: 'policyNumber', javaType: 'String' }])]]), CTX);
  assert.match(p.content, /var projected = new PolicyList\(\s+event\.aggregateId\(\),/s);
  assert.match(p.content, /repository\.save\(new PolicyListEntity\(event\.aggregateId\(\), projected\.policyKey\(\),/);
});

test('an identity field marked :Key is a composite member looked up by the aggregate id', () => {
  const rm = (() => {
    const base = keyedRm();
    const identity = { ...IDENTITY_FIELD, key: true };
    return {
      ...base,
      fields: [identity, ...base.fields.filter((f) => f.name !== 'policyNumber')],
      keyFields: [identity],
    };
  })();
  const p = persistingProjector(rm, new Map([['policy-issued', issuedEvent([{ name: 'policyHolder', javaType: 'PolicyHolder' }])]]), CTX);
  assert.match(p.content, /repository\.findById\(new PolicyListKey\(evt\.aggregateId\(\)\)\)/);
  assert.match(p.content, /new PolicyListEntity\(new PolicyListKey\(projected\.policyKey\(\)\), projected\.policyHolder\(\)\)/);

  const keyClass = readModelKey(rm);
  assert.match(keyClass.content, /Long policyKey/);
});

test('a :Key field is never a search path — it lives in the @EmbeddedId', () => {
  const rm = (() => {
    const base = keyedRm();
    const identity = { ...IDENTITY_FIELD, key: true, searchable: true };
    return { ...base, fields: [identity, ...base.fields], keyFields: [identity] };
  })();
  const j = readModelJpaRepository(rm);
  assert.doesNotMatch(j.content, /policyKey/);
  const mem = readModelInMemoryRepository(rm);
  assert.doesNotMatch(mem.content, /case "policyKey"/);
});

// --- persisting projector, single-record shape (<aggregate>:Key) ----------------
// ":Key" shares the persisting write side with ":RowKey" (entity, repositories,
// per-event row advance) and differs only on the query side: one record looked
// up by aggregate id instead of a searchable list of rows.

const singleRm = () => ({
  id: 'policy-card',
  className: 'PolicyCard',
  package: VA_ENT,
  getterMethod: 'getPolicyCard',
  getMapping: 'policy-card/{aggregateId}',
  collection: false,
  dslMethod: 'expect_policy_card',
  entityClassName: 'PolicyCardEntity',
  idClassName: 'PolicyCardKey',
  projectorClassName: 'PolicyCardProjector',
  abilityClassName: 'PolicyCardProjectorAbility',
  repositoryClassName: 'PolicyCardRepository',
  inMemoryRepositoryClassName: 'PolicyCardInMemoryRepository',
  repositoryConstant: 'POLICY_CARD_REPOSITORY',
  tableName: 'policy_card',
  subscribes: ['policy-issued'],
  keyFields: [],
  searchOnlyFields: [],
  fields: [IDENTITY_FIELD, { name: 'policyNumber', label: 'policy number', javaType: 'String', imports: [] }],
});

test('persistingProjector serves a single record by aggregate id, with no search map', () => {
  const p = persistingProjector(singleRm(), new Map([['policy-issued', issuedEvent([{ name: 'policyNumber', javaType: 'String' }])]]), CTX);
  assert.match(p.content, /@GetMapping\("policy-card\/\{aggregateId\}"\)/);
  assert.match(p.content, /public PolicyCard getPolicyCard\(@PathVariable Long aggregateId\)/);
  assert.match(p.content, /repository\.findById\(aggregateId\)/);
  assert.match(p.content, /\.map\(PolicyCardEntity::toReadModel\)/);
  assert.doesNotMatch(p.content, /@RequestParam|findAllBySearch/);
  assert.match(p.content, /import org\.springframework\.web\.bind\.annotation\.PathVariable;/);
  // The write side is the shared persisting one: the row is advanced on append.
  assert.match(p.content, /implements PersistingProjector/);
  assert.match(p.content, /repository\.save\(new PolicyCardEntity\(event\.aggregateId\(\), projected\.policyKey\(\), projected\.policyNumber\(\)\)\)/);
});

test('persistingProjectorAbility asserts the one row its aggregate id returns', () => {
  const a = persistingProjectorAbility(singleRm(), CTX, []);
  assert.match(a.content, /default boolean expect_policy_card\(Long aggregateId, Predicate<PolicyCard> testCase\)/);
  assert.doesNotMatch(a.content, /List<PolicyCard>/);
  assert.doesNotMatch(a.content, /Map<String, String>/);
});

test('a single-record persisting projector and a row-list one differ only in the getter', () => {
  const eventsById = new Map([['policy-issued', issuedEvent([{ name: 'policyNumber', javaType: 'String' }])]]);
  const single = persistingProjector(singleRm(), eventsById, CTX);
  const rows = persistingProjector({ ...singleRm(), collection: true, getMapping: 'policy-card' }, eventsById, CTX);
  assert.match(single.content, /public PolicyCard getPolicyCard\(@PathVariable Long aggregateId\)/);
  assert.match(rows.content, /public List<PolicyCard> getPolicyCard\(@RequestParam Map<String, String> search\)/);
  // identical write side — same per-event dispatch and apply() folds
  assert.equal(
    single.content.split('    @Override\n    public void project')[1],
    rows.content.split('    @Override\n    public void project')[1],
  );
});

