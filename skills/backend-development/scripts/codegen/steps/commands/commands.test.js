// GENERATE_COMMANDS: how event fields are sourced from the command, and which
// decisions a handler owns as a private throwing method.

import test from 'node:test';
import assert from 'node:assert/strict';
import naming from '../../model/naming.js';
import { parseField } from '../../model/parse.js';
import { createEmitContext } from '../../core/context.js';
import { command, commandHandler } from './index.js';

const BASE = 'pl.pjaworski.insurance_company';
const CTX = createEmitContext({ basePackage: BASE });

// --- command-owned decisions and aggregate state -----------------------------

const cmdField = (label, javaType = 'String') => ({ ...parseField(label), javaType, imports: [] });

test('a command with NO bracketed field injects only the event stream and aggregate id sequence', () => {
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const e = { ...naming.event(BASE, 'policy-issued'), id: 'policy-issued', fields: [cmdField('policy holder')] };

  const handler = commandHandler(c, [e], CTX);
  assert.match(handler.content, /private final EventStream eventStream;/);
  assert.match(handler.content, /private final AggregateIdSequence aggregateIdSequence;/);
  assert.doesNotMatch(handler.content, /\.check\(command\)/);
});

test('a bracketed non-aggregate decision is a private throwing method in the handler', () => {
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const e = {
    ...naming.event(BASE, 'policy-issued'),
    id: 'policy-issued',
    fields: [cmdField('policy holder'), cmdField('[policy number]')],
  };

  const handler = commandHandler(c, [e], CTX);
  assert.match(handler.content, /policyNumber\(\)/);
  assert.match(handler.content, /private String policyNumber\(\)[\s\S]*UnsupportedOperationException/);
});

test('a multi-produce command appends every produced event in one List.of, with per-event decisions', () => {
  const c = { ...naming.command(BASE, 'issue-policy'), id: 'issue-policy', fields: [cmdField('policy holder')] };
  const issued = {
    ...naming.event(BASE, 'policy-issued'),
    id: 'policy-issued',
    fields: [cmdField('policy holder'), cmdField('[policy number]')],
  };
  const premium = {
    ...naming.event(BASE, 'premium-calculated'),
    id: 'premium-calculated',
    fields: [cmdField('[premium amount]', 'BigDecimal')],
  };

  const handler = commandHandler(c, [issued, premium], CTX);
  assert.match(
    handler.content,
    /eventStream\.append\(List\.of\(new PolicyIssuedEvent\([\s\S]*new PremiumCalculatedEvent\([\s\S]*\)\)\);/,
  );
  assert.match(handler.content, /import .*\.domain\.events\.PolicyIssuedEvent;/);
  assert.match(handler.content, /import .*\.domain\.events\.PremiumCalculatedEvent;/);
  // each decision names ITS OWN event, not the command's first one
  assert.match(handler.content, /\[policy number\] on event 'policy-issued'/);
  assert.match(handler.content, /\[premium amount\] on event 'premium-calculated'/);
});

