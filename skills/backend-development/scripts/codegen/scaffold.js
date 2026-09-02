// Ownership bookkeeping for `once: true` files.
//
// `once` files (the event-sourcing runtime, plus every *Decider) are scaffolded
// when absent and then belong to the project forever — the generator must never
// rewrite them, because they carry hand-written business logic.
//
// That guarantee has a sharp edge: when a runtime TEMPLATE evolves, files
// scaffolded from an older version are silently left behind. The build then
// breaks far from the cause (a generated caller referencing a runtime member
// that its stale callee never grew), while `--check` still reports "up to date".
//
// So each `once` file carries a `scaffold-version:` marker. The generator does
// not repair drift — these files may hold local edits that an auto-merge would
// destroy — it REPORTS it and fails `--check`. Reconciliation is deliberate and
// manual; `--accept-scaffold` records that it happened.
//
// Everything here is a pure string function so it can be unit-tested without
// touching a filesystem.

export const VERSION_TAG = 'scaffold-version';
export const PRESERVE_TAG = 'PRESERVED-BY-HAND';

const VERSION_RE = new RegExp(`^//\\s*${VERSION_TAG}:\\s*(\\d+)\\s*$`, 'm');

/**
 * A hand-written edit on a GENERATED file is an explicit, deliberate deviation
 * from the model (e.g. `risk` became an enum the model can't express, or a value
 * object gained a type the abstraction doesn't cover). The generator can't
 * distinguish intent from staleness on its own, so the human/agent that makes
 * the edit stamps it with `// PRESERVED-BY-HAND: <reason>`. `--check` then
 * tolerates that file while still failing on unmarked drift.
 */
export const PRESERVE_RE = new RegExp(`^//\\s*${PRESERVE_TAG}:\\s*(.+)$`, 'm');

/** The reason a generated file was deliberately hand-edited, or null. */
export function preservedReason(content) {
  const m = PRESERVE_RE.exec(content);
  return m ? m[1].trim() : null;
}

/** Files predating the marker read as 0, which is exactly what they are. */
export function parseScaffoldVersion(content) {
  const m = VERSION_RE.exec(content);
  return m ? Number(m[1]) : 0;
}

/** The leading `//` comment block of a generated template. */
export function leadingCommentBlock(content) {
  const lines = content.split('\n');
  const end = lines.findIndex((l) => !l.startsWith('//'));
  return (end === -1 ? lines : lines.slice(0, end)).join('\n');
}

/**
 * Write `version` into `content`, preserving the file's body verbatim.
 *
 * Three cases, in order of decreasing tidiness:
 *   1. marker present            -> rewrite the number
 *   2. scaffold header, no marker-> insert the marker under the header's first line
 *   3. no header at all          -> prepend the template's header (the file was
 *                                   hand-written before the generator existed)
 */
export function stampScaffoldVersion(content, version, templateContent = '') {
  const marker = `// ${VERSION_TAG}: ${version}`;

  if (VERSION_RE.test(content)) return content.replace(VERSION_RE, marker);

  const lines = content.split('\n');
  if (lines[0]?.startsWith('// SCAFFOLDED ONCE')) {
    lines.splice(1, 0, marker);
    return lines.join('\n');
  }

  const header = leadingCommentBlock(templateContent);
  if (!header) return `${marker}\n${content}`;
  const stampedHeader = VERSION_RE.test(header)
    ? header.replace(VERSION_RE, marker)
    : `${header.split('\n')[0]}\n${marker}\n${header.split('\n').slice(1).join('\n')}`;
  return `${stampedHeader.replace(/\n+$/, '')}\n${content}`;
}

/**
 * Groovy specs are only compiled from the Groovy source root. One placed under
 * the Java root is not a compile error — it emits no class at all, and surefire
 * then reports the test "does not exist". Silent, and expensive to diagnose.
 */
export const isSpecFile = (p) => /(Spec|Specification)\.groovy$/.test(p);

export function misplacedSpecs(paths) {
  return paths.filter(isSpecFile);
}
