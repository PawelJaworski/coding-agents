// Ownership of `once: true` files and the source roots they live in.
//
// The bookkeeping that used to be stamped into those files as comments lives in
// `<project>/generator-state.json` — see state.test.js for that contract.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isSpecFile, misplacedSpecs } from './scaffold.js';

test('only Groovy specs are flagged as misplaced', () => {
  assert.deepEqual(
    misplacedSpecs([
      'src/test/java/x/PolicyDetailsSpec.groovy',
      'src/test/java/x/FooSpecification.groovy',
      'src/test/java/x/IssuePolicyAbility.java',   // generated abilities belong here
      'src/test/java/x/helper.groovy',             // not a spec
    ]),
    ['src/test/java/x/PolicyDetailsSpec.groovy', 'src/test/java/x/FooSpecification.groovy'],
  );
});

test('isSpecFile matches both Spec and Specification suffixes, and nothing else', () => {
  assert.equal(isSpecFile('a/ThingSpec.groovy'), true);
  assert.equal(isSpecFile('a/ThingSpecification.groovy'), true);
  assert.equal(isSpecFile('a/ThingSpec.java'), false);
  assert.equal(isSpecFile('a/Inspector.groovy'), false);
});
