// Shared emit kit: the generic seams every step's emitters build Java from.
// The collaborator helpers decide every generated constructor signature and
// every test-ability wiring, so a regression here silently changes all of them.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collaborator,
  fieldDeclarations,
  constructorArgs,
  collaboratorImports,
  collaboratorScaffolds,
  resolveArg,
} from './index.js';

const BASE = 'pl.pjaworski.insurance_company';

// --- collaborators -----------------------------------------------------------
// The generic seam that replaced the `needsDecider` boolean. These helpers
// decide every generated constructor signature and every test-ability wiring
// expression, so they are pinned down here: the point of the abstraction is
// that NOTHING below mentions a decider, a repository or any other specific
// kind — a new kind must work by construction, not by adding a branch.

const CLOCK = collaborator({
  fieldName: 'clock',
  className: 'Clock',
  testInstantiation: 'Clock.systemUTC()',
  scaffold: () => ({ className: 'Clock', once: true }),
});
const HANDLER = { fieldName: 'this' };

const EVENT_STREAM = collaborator({
  fieldName: 'eventStream',
  className: 'EventStream',
  testInstantiation: 'EventStreamAbility.INSTANCE',
  imports: [`${BASE}.eventstream.EventStream`],
});

const REPOSITORY = collaborator({
  fieldName: 'repository',
  className: 'PolicyListRepository',
  testInstantiation: 'PolicyListProjectorAbility.POLICY_LIST_REPOSITORY',
});

test('collaborator defaults: no imports, no scaffold', () => {
  const c = collaborator({ fieldName: 'clock', className: 'Clock', testInstantiation: 'Clock.systemUTC()' });
  assert.deepEqual(c.imports, []);
  assert.equal(c.scaffold, null);
});

test('field declarations are emitted in order, one per collaborator', () => {
  // Order matters: Lombok derives the constructor signature from declaration
  // order, and the generated abilities call that exact signature positionally.
  assert.equal(
    fieldDeclarations([EVENT_STREAM, CLOCK]),
    '    private final EventStream eventStream;\n' +
      '    private final Clock clock;',
  );
});

test('a single collaborator emits no stray separator', () => {
  assert.equal(fieldDeclarations([EVENT_STREAM]), '    private final EventStream eventStream;');
});

test('constructor args use each collaborator\'s own instantiation form', () => {
  // The whole reason this is per-collaborator DATA and not a rule: a clock
  // and a repository have different construction expressions. Both are ordinary
  // collaborators; only their strings differ.
  assert.equal(
    constructorArgs([REPOSITORY, CLOCK]),
    'PolicyListProjectorAbility.POLICY_LIST_REPOSITORY, Clock.systemUTC()',
  );
  assert.equal(
    constructorArgs([EVENT_STREAM, CLOCK]),
    'EventStreamAbility.INSTANCE, Clock.systemUTC()',
  );
});

test('constructor args and field declarations agree on arity and order', () => {
  const cs = [EVENT_STREAM, CLOCK, REPOSITORY];
  assert.equal(constructorArgs(cs).split(', ').length, fieldDeclarations(cs).split('\n').length);
  assert.equal(constructorArgs([]), '');
  assert.equal(fieldDeclarations([]), '');
});

test('collaborator imports are collected, including from same-package kinds that have none', () => {
  assert.deepEqual(collaboratorImports([EVENT_STREAM, CLOCK]), [`${BASE}.eventstream.EventStream`]);
  assert.deepEqual(collaboratorImports([CLOCK, REPOSITORY]), []);
});

test('only collaborators carrying a scaffold contribute a file', () => {
  const files = collaboratorScaffolds([EVENT_STREAM, CLOCK, REPOSITORY]);
  assert.equal(files.length, 1);
  assert.equal(files[0].className, 'Clock');
  assert.deepEqual(collaboratorScaffolds([EVENT_STREAM, REPOSITORY]), []);
});

test('an arbitrary NEW collaborator kind needs no generator change', () => {
  // The regression this guards: reintroducing a per-kind branch. A validator is
  // a kind the generator has never heard of, yet it wires correctly.
  const validator = collaborator({
    fieldName: 'validator',
    className: 'IssuePolicyValidator',
    testInstantiation: 'new IssuePolicyValidator()',
    imports: [`${BASE}.validation.IssuePolicyValidator`],
    scaffold: () => ({ className: 'IssuePolicyValidator', once: true }),
  });
  const cs = [EVENT_STREAM, validator, CLOCK];
  assert.equal(
    fieldDeclarations(cs),
    '    private final EventStream eventStream;\n' +
      '    private final IssuePolicyValidator validator;\n' +
      '    private final Clock clock;',
  );
  assert.equal(
    constructorArgs(cs),
    'EventStreamAbility.INSTANCE, new IssuePolicyValidator(), Clock.systemUTC()',
  );
  assert.deepEqual(collaboratorScaffolds(cs).map((f) => f.className), [
    'IssuePolicyValidator',
    'Clock',
  ]);
});

// --- resolveArg --------------------------------------------------------------

const field = (over = {}) => ({ name: 'policyNumber', label: 'policy number', imports: [], ...over });

test('a convention field resolves to its expression, never to a collaborator', () => {
  const r = resolveArg(
    field({ convention: 'uuid', conventionExpr: 'UUID.randomUUID()', imports: ['java.util.UUID'] }),
    { sourceFields: [], sourceExpr: 'command', delegate: HANDLER },
  );
  assert.equal(r.expr, 'UUID.randomUUID()');
  assert.ok(!r.delegated);
});

test('a passthrough field is derived from the source, not delegated', () => {
  const r = resolveArg(field({ name: 'policyHolder' }), {
    sourceFields: [{ name: 'policyHolder' }],
    sourceExpr: 'command',
    delegate: HANDLER,
  });
  assert.equal(r.expr, 'command.policyHolder()');
  assert.ok(!r.delegated);
});

test('a bracketed field delegates to the collaborator by FIELD NAME, not by type', () => {
  // Proves the resolver has no notion of what it delegates to: swap in any
  // collaborator and the call is routed through its field name.
  const r = resolveArg(field({ bracketed: true }), {
    sourceFields: [],
    sourceExpr: 'command',
    delegate: HANDLER,
  });
  assert.equal(r.expr, 'this.policyNumber()');
  assert.ok(r.delegated);

  const viaOther = resolveArg(field({ bracketed: true }), {
    sourceFields: [],
    sourceExpr: 'command',
    delegate: { fieldName: 'validator' },
  });
  assert.equal(viaOther.expr, 'validator.policyNumber()');
});

test('delegate args are passed through when the caller supplies them', () => {
  const r = resolveArg(field({ bracketed: true }), {
    sourceFields: [],
    sourceExpr: 'event',
    delegate: { ...HANDLER, args: 'state, event' },
  });
  assert.equal(r.expr, 'this.policyNumber(state, event)');
});

test('an unresolvable field returns null so the caller can raise a model gap', () => {
  assert.equal(
    resolveArg(field(), { sourceFields: [], sourceExpr: 'command', delegate: HANDLER }),
    null,
  );
});

test('a fallback resolves what the source cannot supply', () => {
  const r = resolveArg(field(), {
    sourceFields: [],
    sourceExpr: 'event',
    delegate: HANDLER,
    fallback: (f) => `state == null ? null : state.${f.name}()`,
  });
  assert.equal(r.expr, 'state == null ? null : state.policyNumber()');
});
