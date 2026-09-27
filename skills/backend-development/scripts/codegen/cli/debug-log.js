import fs from 'node:fs';
import path from 'node:path';

export const DEBUG_LOG_PATH = '.codegen/codegen-debug.log';

function renderDetails(details) {
  if (details === undefined || details === null) return '';
  if (typeof details === 'string') return `\n${details}`;
  return `\n${JSON.stringify(details, null, 2)}`;
}

export function createDebugLogger({ enabled, projectRoot, nested = false, argv = [] }) {
  const file = path.join(projectRoot, DEBUG_LOG_PATH);
  if (!enabled) return { log() {}, prompt() {} };

  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '# Backend codegen debug\n');
  fs.appendFileSync(
    file,
    `\n# Invocation${nested ? ' (nested)' : ''}\n\ncommand: node scripts/codegen ${argv.join(' ')}\n`,
  );

  return {
    log(step, details) {
      fs.appendFileSync(file, `\n## ${step}${renderDetails(details)}\n`);
    },
    // Logs the exact, unescaped text handed to the agent — readable as-is,
    // not JSON-escaped the way log() renders structured details.
    prompt(label, text) {
      if (text === null || text === undefined) return;
      fs.appendFileSync(file, `\n## PROMPT: ${label}\n\`\`\`\n${text}\n\`\`\`\n`);
    },
  };
}
