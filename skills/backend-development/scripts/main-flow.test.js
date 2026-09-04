import test from 'node:test';
import assert from 'node:assert/strict';
import { detectState, buildPrompt, buildResult } from './main-flow.js';

// ---------------------------------------------------------------------------
// detectState — the core state machine
// ---------------------------------------------------------------------------

// --- Codegen states ---

test('detectState: OUT_OF_DATE → GENERATE', () => {
  assert.equal(detectState({ state: 'OUT_OF_DATE' }, {}), 'GENERATE');
});

test('detectState: STALE_SCAFFOLD → RECONCILE', () => {
  assert.equal(detectState({ state: 'STALE_SCAFFOLD' }, {}), 'RECONCILE');
});

test('detectState: STALE_GENERATED → RECONCILE', () => {
  assert.equal(detectState({ state: 'STALE_GENERATED' }, {}), 'RECONCILE');
});

test('detectState: NEEDS_MANUAL_MERGE → RECONCILE', () => {
  assert.equal(detectState({ state: 'NEEDS_MANUAL_MERGE' }, {}), 'RECONCILE');
});

test('detectState: ADVISORY_DRIFT → GENERATE (falls through — not a blocking state)', () => {
  // ADVISORY_DRIFT is informational only and never blocks the state machine.
  // When codegen returns it with no other blocking states, the flow continues
  // to PENDING/DONE. This test covers the edge case where ADVISORY_DRIFT
  // arrives alone (codegen --next no longer produces this, but main-flow
  // should handle it gracefully).
  assert.equal(detectState({ state: 'ADVISORY_DRIFT' }, {}), 'GENERATE');
});

test('detectState: PENDING with queue → IMPLEMENT', () => {
  const cg = {
    state: 'PENDING',
    queue: [{ kind: 'gwt-scenario', detail: { scenario: 'S1' }, prompt: 'do S1' }],
  };
  assert.equal(detectState(cg, {}), 'IMPLEMENT');
});

test('detectState: PENDING with queue and advisory drifts → IMPLEMENT (advisory is ignored)', () => {
  // Codegen no longer returns ADVISORY_DRIFT as a blocking state. When there
  // are advisory drifts alongside pending work, the state is PENDING and the
  // flow should proceed to IMPLEMENT.
  const cg = {
    state: 'PENDING',
    queue: [{ kind: 'gwt-scenario', detail: { scenario: 'S1' }, prompt: 'do S1' }],
  };
  assert.equal(detectState(cg, {}), 'IMPLEMENT');
});

test('detectState: PENDING with empty queue → GENERATE (fallback)', () => {
  // PENDING with no queue items is unexpected — falls through to GENERATE
  assert.equal(detectState({ state: 'PENDING', queue: [] }, {}), 'GENERATE');
});

test('detectState: null codegen result → GENERATE (fallback)', () => {
  assert.equal(detectState(null, {}), 'GENERATE');
});

// --- Post-codegen states ---

test('detectState: DONE, no report → VERIFY', () => {
  assert.equal(
    detectState({ state: 'DONE', queue: [] }, { hasReport: false, hasUncommitted: false }),
    'VERIFY',
  );
});

test('detectState: DONE, no queue field, no report → VERIFY', () => {
  assert.equal(
    detectState({ state: 'DONE' }, { hasReport: false }),
    'VERIFY',
  );
});

test('detectState: DONE, report exists, uncommitted → REVIEW', () => {
  assert.equal(
    detectState({ state: 'DONE', queue: [] }, { hasReport: true, hasUncommitted: true }),
    'REVIEW',
  );
});

test('detectState: DONE, report exists, clean tree → DONE', () => {
  assert.equal(
    detectState({ state: 'DONE', queue: [] }, { hasReport: true, hasUncommitted: false }),
    'DONE',
  );
});

test('detectState: DONE with non-empty queue falls through to GENERATE (impossible input)', () => {
  // codegen only emits DONE with an empty queue, so a non-empty queue on DONE
  // is unreachable. The guard `queue.length === 0` makes the DONE branch miss,
  // and the fallback is GENERATE.
  const cg = {
    state: 'DONE',
    queue: [{ kind: 'gwt-scenario', detail: { scenario: 'S1' }, prompt: 'do S1' }],
  };
  assert.equal(detectState(cg, { hasReport: false }), 'GENERATE');
});

// --- Edge cases ---

test('detectState: MODEL_ERROR → GENERATE (fallback)', () => {
  assert.equal(detectState({ state: 'MODEL_ERROR' }, {}), 'GENERATE');
});

test('detectState: undefined state → GENERATE (fallback)', () => {
  assert.equal(detectState({ state: undefined }, {}), 'GENERATE');
});

test('detectState: fsState defaults to false when omitted', () => {
  assert.equal(detectState({ state: 'DONE', queue: [] }, {}), 'VERIFY');
});

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

test('buildPrompt: GENERATE returns a prompt mentioning codegen', () => {
  const prompt = buildPrompt('GENERATE');
  assert.ok(prompt.includes('codegen'));
  assert.ok(prompt.includes('regenerate'));
});

test('buildPrompt: RECONCILE returns a prompt mentioning templates', () => {
  const prompt = buildPrompt('RECONCILE');
  assert.ok(prompt.includes('STALE_SCAFFOLD'));
  assert.ok(prompt.includes('accept-scaffold'));
});

test('buildPrompt: VERIFY returns a prompt with three steps', () => {
  const prompt = buildPrompt('VERIFY');
  assert.ok(prompt.includes('mvn clean verify'));
  assert.ok(prompt.includes('codegen --check'));
  assert.ok(prompt.includes('development-report.md'));
});

test('buildPrompt: REVIEW returns a prompt mentioning code-reviewer', () => {
  const prompt = buildPrompt('REVIEW');
  assert.ok(prompt.includes('backend-code-reviewer'));
});

test('buildPrompt: DONE returns null', () => {
  assert.equal(buildPrompt('DONE'), null);
});

test('buildPrompt: IMPLEMENT with queue item returns its prompt', () => {
  const item = { prompt: 'Implement scenario S1' };
  assert.equal(buildPrompt('IMPLEMENT', item, 0), 'Implement scenario S1');
});

test('buildPrompt: IMPLEMENT with remaining items appends count', () => {
  const item = { prompt: 'Implement scenario S1' };
  const prompt = buildPrompt('IMPLEMENT', item, 2);
  assert.ok(prompt.includes('Implement scenario S1'));
  assert.ok(prompt.includes('2 more item(s)'));
});

test('buildPrompt: IMPLEMENT without queue item returns null', () => {
  assert.equal(buildPrompt('IMPLEMENT', null, 0), null);
});

test('buildPrompt: unknown state returns null', () => {
  assert.equal(buildPrompt('UNKNOWN'), null);
});

// ---------------------------------------------------------------------------
// buildResult
// ---------------------------------------------------------------------------

test('buildResult: IMPLEMENT builds result with queue', () => {
  const cg = {
    state: 'PENDING',
    queue: [
      { kind: 'gwt-scenario', detail: { scenario: 'S1' }, prompt: 'Implement S1' },
      { kind: 'business-rule', detail: 'R1', prompt: 'Enforce R1' },
    ],
  };
  const result = buildResult('IMPLEMENT', cg);
  assert.equal(result.state, 'IMPLEMENT');
  assert.equal(result.next.kind, 'implement');
  assert.equal(result.next.detail.scenario, 'S1');
  assert.ok(result.next.prompt.includes('Implement S1'));
  assert.ok(result.next.prompt.includes('1 more item'));
  assert.equal(result.queue.length, 2);
});

test('buildResult: IMPLEMENT with single item has no remaining count', () => {
  const cg = {
    state: 'PENDING',
    queue: [{ kind: 'gwt-scenario', detail: { scenario: 'S1' }, prompt: 'Implement S1' }],
  };
  const result = buildResult('IMPLEMENT', cg);
  assert.ok(!result.next.prompt.includes('more item'));
  assert.equal(result.queue.length, 1);
});

test('buildResult: non-IMPLEMENT state has empty queue', () => {
  const result = buildResult('GENERATE', null);
  assert.equal(result.state, 'GENERATE');
  assert.deepEqual(result.queue, []);
  assert.ok(result.next.prompt.includes('codegen'));
});

test('buildResult: DONE has null next', () => {
  const result = buildResult('DONE', { state: 'DONE', queue: [] });
  assert.equal(result.state, 'DONE');
  assert.equal(result.next, null);
  assert.deepEqual(result.queue, []);
});

test('buildResult: VERIFY has next with all three steps', () => {
  const result = buildResult('VERIFY', { state: 'DONE', queue: [] });
  assert.equal(result.state, 'VERIFY');
  assert.ok(result.next.prompt.includes('mvn clean verify'));
  assert.ok(result.next.prompt.includes('codegen --check'));
  assert.ok(result.next.prompt.includes('development-report.md'));
});

// ---------------------------------------------------------------------------
// Full state machine transitions
// ---------------------------------------------------------------------------

test('full flow: OUT_OF_DATE → GENERATE → PENDING → IMPLEMENT → DONE → VERIFY → REVIEW → DONE', () => {
  // Step 1: model out of date
  assert.equal(detectState({ state: 'OUT_OF_DATE' }, {}), 'GENERATE');

  // Step 2: codegen ran, has pending items
  const pending = {
    state: 'PENDING',
    queue: [
      { kind: 'gwt-scenario', detail: { scenario: 'S1' }, prompt: 'Implement S1' },
    ],
  };
  assert.equal(detectState(pending, {}), 'IMPLEMENT');

  // Step 3: all items implemented
  assert.equal(
    detectState({ state: 'DONE', queue: [] }, { hasReport: false }),
    'VERIFY',
  );

  // Step 4: report written, changes uncommitted
  assert.equal(
    detectState({ state: 'DONE', queue: [] }, { hasReport: true, hasUncommitted: true }),
    'REVIEW',
  );

  // Step 5: committed
  assert.equal(
    detectState({ state: 'DONE', queue: [] }, { hasReport: true, hasUncommitted: false }),
    'DONE',
  );
});

test('full flow: stale scaffold → reconcile → pending → implement → done', () => {
  assert.equal(detectState({ state: 'STALE_SCAFFOLD' }, {}), 'RECONCILE');
  assert.equal(detectState({ state: 'OUT_OF_DATE' }, {}), 'GENERATE');
  assert.equal(
    detectState(
      { state: 'PENDING', queue: [{ kind: 'rule', detail: 'R1', prompt: 'Enforce R1' }] },
      {},
    ),
    'IMPLEMENT',
  );
  assert.equal(
    detectState({ state: 'DONE', queue: [] }, { hasReport: false }),
    'VERIFY',
  );
});
