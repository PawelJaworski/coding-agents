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
  if (!enabled) {
    if (!nested && fs.existsSync(file)) fs.unlinkSync(file);
    return { log() {} };
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const header = `# Backend codegen debug\n\ncommand: node scripts/codegen ${argv.join(' ')}\n`;
  fs.writeFileSync(file, header, { flag: nested ? 'a' : 'w' });

  return {
    log(step, details) {
      fs.appendFileSync(file, `\n## ${step}${renderDetails(details)}\n`);
    },
  };
}
