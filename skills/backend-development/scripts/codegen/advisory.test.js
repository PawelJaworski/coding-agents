import test from 'node:test';
import assert from 'node:assert/strict';
import { isLogicFile, computeAdvisory } from './advisory.js';

test('isLogicFile: returns true for files with logic: true or once: true', () => {
  assert.equal(isLogicFile({ logic: true }), true);
  assert.equal(isLogicFile({ once: true }), true);
  assert.equal(isLogicFile({ overwrite: true }), false);
});

test('computeAdvisory: returns null when content matches generated template', () => {
  const content = `package com.example;

public class IssuePolicyHandler {
    public void handle() {
    }
}
`;
  const res = computeAdvisory({
    currentContent: content,
    generatedContent: content,
    relPath: 'src/main/java/com/example/IssuePolicyHandler.java',
  });
  assert.equal(res, null);
});

test('computeAdvisory: returns isPreserved when stamped with PRESERVED-BY-HAND', () => {
  const current = `// PRESERVED-BY-HAND: custom handler logic
package com.example;

public class IssuePolicyHandler {
    public void handleCustom() {
    }
}
`;
  const generated = `package com.example;

public class IssuePolicyHandler {
    public void handle() {
    }
}
`;
  const res = computeAdvisory({
    currentContent: current,
    generatedContent: generated,
    relPath: 'src/main/java/com/example/IssuePolicyHandler.java',
  });
  assert.ok(res);
  assert.equal(res.isPreserved, true);
  assert.equal(res.reason, 'custom handler logic');
});

test('computeAdvisory: detects missing method from model and returns prompt with snippet', () => {
  const current = `package com.example;

public class PolicyProjector {
    public void apply(State state, PolicyIssuedEvent event) {
    }
}
`;
  const generated = `package com.example;

public class PolicyProjector {
    public void apply(State state, PolicyIssuedEvent event) {
    }

    public void apply(State state, PolicyCancelledEvent event) {
        return state;
    }
}
`;
  const res = computeAdvisory({
    currentContent: current,
    generatedContent: generated,
    relPath: 'src/main/java/com/example/PolicyProjector.java',
  });
  assert.ok(res);
  assert.equal(res.hasDrift, true);
  assert.equal(res.missingMembers.length, 1);
  assert.match(res.prompt, /PolicyCancelledEvent/);
  assert.match(res.prompt, /Missing member\(s\) to add/);
});

test('computeAdvisory: detects drifted method body and returns prompt with snippet', () => {
  const current = `package com.example;

public class IssuePolicyHandler {
    @PostMapping("issue-policy")
    public UUID handle(IssuePolicyCmd command) {
        return UUID.randomUUID();
    }
}
`;
  const generated = `package com.example;

public class IssuePolicyHandler {
    @PostMapping("issue-policy")
    public UUID handle(IssuePolicyCmd command) {
        decider.check(command);
        return UUID.randomUUID();
    }
}
`;
  const res = computeAdvisory({
    currentContent: current,
    generatedContent: generated,
    relPath: 'src/main/java/com/example/IssuePolicyHandler.java',
  });
  assert.ok(res);
  assert.equal(res.hasDrift, true);
  assert.equal(res.driftedMembers.length, 1);
  assert.match(res.prompt, /decider\.check\(command\)/);
  assert.match(res.prompt, /Member\(s\) requiring update/);
});

test('computeAdvisory: tolerates custom hand-added methods not in generated model', () => {
  const current = `package com.example;

public class PolicyRepository {
    public void save(Entity e) {}

    // custom hand-added query
    public List<Entity> findCustom() {
        return List.of();
    }
}
`;
  const generated = `package com.example;

public class PolicyRepository {
    public void save(Entity e) {}
}
`;
  const res = computeAdvisory({
    currentContent: current,
    generatedContent: generated,
    relPath: 'src/main/java/com/example/PolicyRepository.java',
  });
  assert.equal(res, null);
});
