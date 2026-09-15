import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SKILL = '.opencode/skills/backend-development';

function verificationCommandResult(projectRoot, spawn, command, args) {
  return spawn(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, CODEGEN_DEBUG_NESTED: '1' },
  });
}

export function runVerification(projectRoot, spawn = spawnSync) {
  const outputs = [];

  const mvnwResult = verificationCommandResult(projectRoot, spawn, path.join(projectRoot, 'mvnw'), ['clean', 'verify']);
  outputs.push(mvnwResult.stdout || '', mvnwResult.stderr || '');
  if (mvnwResult.status !== 0) {
    return { ok: false, output: outputs.join('').trim() };
  }

  const checkResult = verificationCommandResult(
    projectRoot,
    spawn,
    'node',
    [path.join(projectRoot, SKILL, 'scripts/codegen'), '--check'],
  );
  outputs.push(checkResult.stdout || '', checkResult.stderr || '');
  if (checkResult.status !== 0) {
    return { ok: false, output: outputs.join('').trim() };
  }

  return { ok: true, output: outputs.join('').trim() };
}

export function verificationFailurePrompt(output) {
  return (
    `The verification gate failed:\n${output}\n\n` +
    'Fix the failing tests, then ask for the next step again.'
  );
}
