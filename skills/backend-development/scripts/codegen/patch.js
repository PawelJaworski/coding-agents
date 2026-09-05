// Model -> code diff, expressed as a machine-readable PATCH instead of prose.
//
// Why this exists: "what is missing in the code compared to the model?" is a
// pure function of (model, disk). An agent asked to answer it will hallucinate
// members, miss others silently, and produce a different answer every run. So
// the diff is computed here, deterministically, and the agent only ever APPLIES
// one entry of the result.
//
// Every entry carries exactly one of three verbs — a closed set, because a weak
// model follows an enum and does not follow a paragraph about intent:
//
//   CREATE  the file does not exist. Pure addition, zero risk.
//   ADD     the file exists and the model grew. Members are INSERTED; nothing
//           that is already there is read, rewritten or removed.
//   UPDATE  the file exists and its own logic conflicts with the model. This is
//           the ONLY verb that can touch hand-written code, and it is deliberately
//           the narrowest: the minimal edit that restores compilation or turns a
//           red test green. Never a wholesale regeneration.
//
// CREATE and ADD are `auto: true` — `codegen` (no flags) performs them itself and
// no agent is involved. Only UPDATE needs a human or an agent, which is why the
// patch is worth reading: it isolates the small, dangerous subset.

import { splitTopLevelMembers, memberKey, splitFile, semanticDrift } from './merge.js';
import { mergeGenerated } from './merge.js';
import { preservedReason, parseScaffoldVersion } from './scaffold.js';
import { isLogicFile } from './advisory.js';

export const CATEGORIES = ['domain', 'commands', 'events', 'readmodels'];

/** Patch filename for a category (`commands` -> `commands-patch.json`). */
export function patchFileName(category) {
  return `${category}-patch.json`;
}

/** Member keys present in `generated` but absent from `current`. */
function missingMemberKeys(current, generated) {
  const cur = splitFile(current);
  const gen = splitFile(generated);
  if (!cur || !gen) return null;
  const have = new Set(splitTopLevelMembers(cur.body).map(memberKey));
  return splitTopLevelMembers(gen.body)
    .map(memberKey)
    .filter((k) => !have.has(k));
}

/**
 * Classify ONE emitted file against its on-disk counterpart.
 *
 * Pure: all IO is done by the caller and handed in. Returns null when the file
 * is already in agreement with the model — a patch only ever lists work.
 *
 * @param {object} params
 * @param {object} params.file - an emit() file: {package, className, content, category, once, version, test}
 * @param {string|null} params.currentContent - file content on disk, or null if absent
 * @param {string} params.relPath - path relative to the project root
 * @returns {object|null} patch entry
 */
export function classifyFile({ file, currentContent, relPath }) {
  const base = {
    category: file.category ?? 'domain',
    package: file.package,
    class: file.className,
    path: relPath,
  };

  if (currentContent == null) {
    return {
      ...base,
      op: 'CREATE',
      auto: true,
      owner: file.once ? 'yours-after-creation' : 'generator',
      members: [],
      hints: file.once ? ['scaffolded once, then yours: business logic goes here'] : [],
    };
  }

  if (currentContent === file.content) return null;

  const preserved = preservedReason(currentContent);
  if (preserved) return null; // a declared, deliberate deviation is not work

  // `once` files (deciders, runtime) are never rewritten. The only thing that can
  // be stale is the scaffold TEMPLATE they were born from.
  if (file.once) {
    const onDisk = parseScaffoldVersion(currentContent);
    const template = file.version ?? 1;
    if (onDisk >= template) return null;
    return {
      ...base,
      op: 'UPDATE',
      auto: false,
      owner: 'yours',
      members: [],
      hints: [
        `template v${onDisk} -> v${template}: port the delta from scripts/codegen/runtime.js,`,
        'then `codegen --accept-scaffold`. Your logic stays.',
      ],
    };
  }

  // Hand-owned logic classes: additive members are ADD, conflicting bodies are UPDATE.
  const missing = missingMemberKeys(currentContent, file.content);
  if (missing === null) {
    return {
      ...base,
      op: 'UPDATE',
      auto: false,
      owner: 'yours',
      members: [],
      hints: ['unparseable shape (expects one top-level type) — reconcile by hand'],
    };
  }

  const drifted = semanticDrift(currentContent, file.content);

  if (drifted.length > 0) {
    return {
      ...base,
      op: 'UPDATE',
      auto: false,
      owner: isLogicFile(file) ? 'yours' : 'generator',
      members: drifted,
      hints: [
        'intentional? add `// PRESERVED-BY-HAND: <reason>`',
        ...(missing.length > 0 ? [`also missing (safe to add): ${missing.join(', ')}`] : []),
      ],
    };
  }

  if (missing.length > 0) {
    const merged = isLogicFile(file) ? null : mergeGenerated(currentContent, file.content);
    return {
      ...base,
      op: 'ADD',
      auto: !isLogicFile(file) && merged !== null,
      owner: isLogicFile(file) ? 'yours' : 'generator',
      members: missing,
      hints: isLogicFile(file) ? ['add only what a compile error or a failing test demands'] : [],
    };
  }

  // No member is missing and none drifted, yet the content still differs: the
  // add-only merge rewrites something sub-member (a placeholder annotation that
  // became real). Fully automatic, but it must not be invisible in the patch —
  // an unlisted difference is indistinguishable from a bug in the classifier.
  if (!isLogicFile(file)) {
    const merged = mergeGenerated(currentContent, file.content);
    if (merged && merged.content !== currentContent) {
      return {
        ...base,
        op: 'ADD',
        auto: true,
        owner: 'generator',
        members: [],
        hints: [],
      };
    }
  }

  return null;
}

/**
 * Group classified entries into one patch document per category.
 *
 * @param {object[]} entries
 * @returns {Record<string, object>} category -> {category, generatedAt-free summary, entries}
 */
export function buildPatches(entries) {
  const out = {};
  for (const category of CATEGORIES) {
    const mine = entries.filter((e) => e.category === category);
    out[category] = {
      category,
      summary: {
        create: mine.filter((e) => e.op === 'CREATE').length,
        add: mine.filter((e) => e.op === 'ADD').length,
        update: mine.filter((e) => e.op === 'UPDATE').length,
        needsAgent: mine.filter((e) => !e.auto).length,
      },
      entries: mine,
    };
  }
  return out;
}

/**
 * The GWT patch: one entry per unimplemented scenario or business rule, each
 * naming the exact spec file it must be written into. Built from the queue
 * `next.js` already computes, so scenarios and rules stay a single source.
 *
 * @param {object[]} queue - output of buildQueue()
 * @returns {object}
 */
export function buildGwtPatch(queue) {
  const entries = (queue || []).map((item) => {
    const isRule = item.kind === 'business-rule';
    const name = isRule ? item.detail.rule : item.detail.scenario;
    const where = /`([^`]+Spec\.groovy)`/.exec(item.prompt)?.[1] ?? null;
    const target = isRule ? item.detail.command : item.detail.readModel;
    return {
      op: 'CREATE',
      auto: false,
      kind: item.kind,
      name,
      source: isRule ? 'business-rules-raw.md' : item.detail.file,
      spec: where,
      package: target?.package ?? null,
      class: where ? where.split('/').pop().replace(/\.groovy$/, '') : null,
      hints: where ? [] : ['spec path underivable — report it, do not guess'],
    };
  });
  return {
    category: 'gwt',
    summary: { create: entries.length, add: 0, update: 0, needsAgent: entries.length },
    entries,
  };
}
