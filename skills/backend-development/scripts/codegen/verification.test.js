import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerification, verificationFailurePrompt } from './verification.js';

test('runVerification: runs mvnw clean verify before codegen --check', () => {
  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, args]);
    return { status: 0, stdout: '', stderr: '' };
  };

  const result = runVerification('/repo', spawn);

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['/repo/mvnw', ['clean', 'verify']],
    ['node', ['/repo/.opencode/skills/backend-development/scripts/codegen', '--check']],
  ]);
});

test('runVerification: stops after the first failing command', () => {
  const calls = [];
  const spawn = (command, args) => {
    calls.push([command, args]);
    return command.endsWith('/mvnw')
      ? { status: 1, stdout: 'unit failed', stderr: 'boom' }
      : { status: 0, stdout: '', stderr: '' };
  };

  const result = runVerification('/repo', spawn);

  assert.equal(result.ok, false);
  assert.match(result.output, /unit failed/);
  assert.match(result.output, /boom/);
  assert.deepEqual(calls, [
    ['/repo/mvnw', ['clean', 'verify']],
  ]);
});

test('verificationFailurePrompt explains that the gate blocked completion', () => {
  const prompt = verificationFailurePrompt('broken integration test');
  assert.match(prompt, /verification gate failed/i);
  assert.match(prompt, /broken integration test/);
  assert.match(prompt, /Fix the failing tests/);
});
