// Add-only reconciliation for `GENERATED` files.
//
// Historically a GENERATED file was a pure function of the model: any drift was
// resolved by overwriting the whole file. That is safe only as long as nobody
// ever needs to hand-extend one — but a persisting projector/repository is
// exactly the place a project outgrows what the model's vocabulary can express
// yet (a search endpoint, a derived query, ...), and overwriting destroys it
// silently the next time an unrelated model change triggers a regen.
//
// New contract:
//   - file absent                          -> written fully (nothing to merge)
//   - file present, byte-identical          -> untouched
//   - file present, generated content ADDS  -> the addition (new record
//     members it doesn't have yet             component, new enum constant, new
//                                              class member) is inserted; every
//                                              existing member/line is kept
//                                              VERBATIM, in place, including any
//                                              hand edits.
//   - file present, nothing new to add      -> untouched, even if the fresh
//                                              generated text would differ
//                                              (e.g. a hand-modified method
//                                              signature) — that difference is
//                                              exactly what this preserves.
//   - file structure not recognised         -> mergeGenerated returns null;
//                                              caller must NOT overwrite and
//                                              must surface it for a human.
//
// This intentionally cannot "modify" an existing member (change a signature,
// alter a body) — only ever add one that's entirely missing. Modifying
// something that already exists is exactly the class of change this project
// wants to require a deliberate human hand for.
//
// SAFETY INVARIANT: this module rewrites files that already exist, so it must
// never emit something it cannot re-parse. Every structural scan runs over a
// MASKED copy of the source (comments and string literals blanked, length and
// line structure preserved) — a brace, semicolon or quote that is really prose
// must never look like structure — and the merged result is re-parsed before it
// is handed back. Anything that fails those checks returns null (-> the caller's
// "needs manual merge" path) instead of writing corrupt Java.

// ---- masking ---------------------------------------------------------------
// All three return a string of EXACTLY the same length as the input, so an index
// into the mask is also an index into the original and slices stay byte-verbatim.

/** Blank `//` line comments and `/* *\/` blocks (javadoc included). */
function maskComments(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    if (src[i] === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j);
      i = j;
    } else if (src[i] === '/' && src[i + 1] === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      blank(i, j);
      i = j;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Blank text blocks, string and char literals (escapes respected). */
function maskStrings(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
      const close = src.indexOf('"""', i + 3);
      const j = close === -1 ? n : close + 3;
      blank(i, j);
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c || src[j] === '\n') { j++; break; }
        j++;
      }
      blank(i, j);
      i = j;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Comments AND literals blanked — the view every brace/semicolon scan uses. */
const maskNonCode = (src) => maskStrings(maskComments(src));

// ---- structural helpers ----------------------------------------------------

/** Depth-aware split on top-level commas (so `List<String>` isn't broken up). */
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '<') depth++;
    else if (c === '>') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Last whitespace-separated token of a param/component declaration is its name. */
function declaredName(param) {
  const tokens = param.trim().split(/\s+/);
  return tokens[tokens.length - 1];
}

/**
 * Split a class/interface body into top-level members (fields, methods,
 * initializer blocks), each returned as the exact source slice it occupies —
 * concatenating the result reproduces the input exactly. Braces nested inside
 * a member (a method body, a lambda, ...) never end the member early; only a
 * `;` or a `}` seen back at depth 0 does.
 *
 * Counting happens on the masked view, so a javadoc `{@code X}` or a `"}"`
 * literal cannot chop a member in half.
 */
function splitTopLevelMembers(body) {
  const masked = maskNonCode(body);
  const members = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        members.push(body.slice(start, i + 1));
        start = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      members.push(body.slice(start, i + 1));
      start = i + 1;
    }
  }
  const rest = body.slice(start);
  if (rest.trim()) members.push(rest);
  return members;
}

/**
 * A member's identity for matching purposes.
 *
 * For a REST-mapped method (`@GetMapping`/`@PostMapping`/...), the identity is
 * the mapping annotation itself (its route): Spring rejects two methods mapped
 * to the same route regardless of their parameter lists, so a hand-added
 * `@RequestParam` (exactly how the search-by-policy-holder extension works)
 * must be recognised as the SAME slot as the plain generated method — never
 * inserted alongside it as a bogus "new" overload.
 *
 * For a field (`Type name = initializer;` or `Type name;`), the identity is
 * its declared NAME alone: Java forbids two same-named fields regardless of
 * type or initializer, so a hand-edited initializer (e.g. wiring a decider
 * differently for a shared static instance) must never be seen as "missing"
 * and re-inserted as a duplicate declaration.
 *
 * Everything else (a method with no mapping annotation) keys on its
 * declaration text (return type, name, parameter TYPES — annotations and
 * body stripped), so genuine overloads (multiple `apply(State, SomeEvent)`
 * methods, one per subscribed event) are correctly treated as distinct
 * members.
 */
const MAPPING_ANNOTATION_RE = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(([^)]*)\)/;

function memberKey(member) {
  // Comments are dropped so a reworded javadoc is not a "different" member, but
  // string literals are KEPT: a mapping's route is part of the member's identity.
  const noComments = maskComments(member);
  const structural = maskStrings(noComments);

  const mapping = MAPPING_ANNOTATION_RE.exec(noComments);
  if (mapping) return `${mapping[1]}Mapping(${mapping[2].replace(/\s+/g, ' ').trim()})`;

  let idx = structural.length;
  for (let i = 0; i < structural.length; i++) {
    if (structural[i] === '{' || structural[i] === ';') {
      idx = i;
      break;
    }
  }
  const header = noComments
    .slice(0, idx)
    .split('\n')
    .filter((line) => !/^\s*@/.test(line.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // A field's assignment `=` comes before any parameter list / constructor
  // call parenthesis; a method's parameter list parenthesis comes first (or
  // there are no parens at all, e.g. `private final Foo bar`).
  const parenPos = header.indexOf('(');
  const eqPos = header.indexOf('=');
  const isField = parenPos === -1 || (eqPos !== -1 && eqPos < parenPos);
  if (isField) {
    const beforeEq = eqPos === -1 ? header : header.slice(0, eqPos);
    const tokens = beforeEq.trim().split(/\s+/);
    return `field ${tokens[tokens.length - 1]}`;
  }
  return header;
}

// ---- locating the top-level type -------------------------------------------

const TYPE_DECL_RE = /\b(?:class|interface|enum|record)\s+\w+/g;

const parenDepthAt = (mask, idx) => {
  let depth = 0;
  for (let i = 0; i < idx; i++) {
    if (mask[i] === '(') depth++;
    else if (mask[i] === ')') depth--;
  }
  return depth;
};

/**
 * Index of the `{` that opens the top-level type's body, or -1.
 *
 * The naive "first `{` in the file" is wrong and was actively corrupting files:
 * in real sources the first brace is routinely inside a javadoc
 * (`* @JsonSubTypes({`) or an annotation argument (`@JsonSubTypes({`), and
 * splitting there makes the annotation tail and the type declaration look like
 * class MEMBERS — which the merge then happily "adds", emitting two top-level
 * types. So: find a type keyword that is real code at paren depth 0, then take
 * the first `{` after it.
 */
function typeBodyBrace(mask) {
  TYPE_DECL_RE.lastIndex = 0;
  let m;
  while ((m = TYPE_DECL_RE.exec(mask)) !== null) {
    if (parenDepthAt(mask, m.index) !== 0) continue;
    for (let i = m.index + m[0].length; i < mask.length; i++) {
      if (mask[i] === '{') return i;
      if (mask[i] === ';') break; // no body (e.g. an annotation member decl)
    }
  }
  return -1;
}

/** Number of type declarations sitting outside any braces — must be exactly 1. */
function topLevelTypeCount(content) {
  const mask = maskNonCode(content);
  const depths = [];
  let depth = 0;
  for (let i = 0; i < mask.length; i++) {
    depths[i] = depth;
    if (mask[i] === '{') depth++;
    else if (mask[i] === '}') depth--;
  }
  if (depth !== 0) return -1; // unbalanced: refuse

  let count = 0;
  TYPE_DECL_RE.lastIndex = 0;
  let m;
  while ((m = TYPE_DECL_RE.exec(mask)) !== null) {
    if (depths[m.index] === 0 && parenDepthAt(mask, m.index) === 0) count++;
  }
  return count;
}

/** The merged text must still be one balanced, single-type compilation unit. */
const isWellFormed = (content) => topLevelTypeCount(content) === 1;

function splitFile(content) {
  const mask = maskNonCode(content);
  const firstBrace = typeBodyBrace(mask);
  const lastBrace = mask.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;
  return {
    prefix: content.slice(0, firstBrace + 1),
    body: content.slice(firstBrace + 1, lastBrace),
    suffix: content.slice(lastBrace),
  };
}

// ---- member (class/interface body) merge -----------------------------------

function mergeMembers(existingBody, generatedBody) {
  const existingKeys = new Set(splitTopLevelMembers(existingBody).map(memberKey));
  const toAdd = splitTopLevelMembers(generatedBody).filter((m) => m.trim() && !existingKeys.has(memberKey(m)));
  if (toAdd.length === 0) return { body: existingBody, added: [] };

  const trimmed = existingBody.replace(/[ \t]+$/, '').replace(/\n*$/, '\n');
  const inserted = toAdd.map((m) => `\n${m.trim()}\n`).join('');
  return { body: `${trimmed}${inserted}`, added: toAdd.map(memberKey) };
}

// ---- record component merge -------------------------------------------------

const RECORD_HEADER_RE = /\brecord\s+(\w+)\s*\(([^)]*)\)/;

function mergeRecordComponents(existingPrefix, generatedPrefix) {
  const existingMatch = RECORD_HEADER_RE.exec(existingPrefix);
  const generatedMatch = RECORD_HEADER_RE.exec(generatedPrefix);
  if (!existingMatch || !generatedMatch) return null;

  const existingParams = splitTopLevelCommas(existingMatch[2]);
  const generatedParams = splitTopLevelCommas(generatedMatch[2]);
  const existingNames = new Set(existingParams.map(declaredName));
  const added = generatedParams.filter((p) => !existingNames.has(declaredName(p)));
  if (added.length === 0) return { prefix: existingPrefix, added: [] };

  const merged = [...existingParams, ...added].join(', ');
  const prefix =
    existingPrefix.slice(0, existingMatch.index) +
    existingPrefix.slice(existingMatch.index, existingMatch.index + existingMatch[0].length).replace(
      RECORD_HEADER_RE,
      `record ${existingMatch[1]}(${merged})`,
    ) +
    existingPrefix.slice(existingMatch.index + existingMatch[0].length);
  return { prefix, added: added.map(declaredName) };
}

// ---- enum constant merge ----------------------------------------------------

const ENUM_HEADER_RE = /\benum\s+\w+\s*$/;

function mergeEnumConstants(existingPrefix, existingBody, generatedBody) {
  if (!ENUM_HEADER_RE.test(existingPrefix.replace(/\{$/, '').trim())) return null;

  const splitConstants = (body) => {
    const boundary = body.indexOf(';');
    const constPart = boundary === -1 ? body : body.slice(0, boundary);
    const rest = boundary === -1 ? '' : body.slice(boundary + 1);
    const names = constPart
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { names, rest };
  };

  const existing = splitConstants(existingBody);
  const generated = splitConstants(generatedBody);
  const existingNames = new Set(existing.names);
  const added = generated.names.filter((n) => !existingNames.has(n));
  if (added.length === 0) return { body: existingBody, added: [] };

  const allNames = [...existing.names, ...added];
  const body = `\n${allNames.map((n) => `    ${n},`).join('\n')}\n${existing.rest}`;
  return { body, added };
}

// ---- import merge ------------------------------------------------------------

/** Only pulls in an import if newly added text actually references its simple name. */
function mergeImports(content, generatedContent, addedText) {
  const importLine = /^import\s+([\w.]+);\s*$/;
  const existingImports = new Set(
    content.split('\n').filter((l) => importLine.test(l.trim())).map((l) => l.trim()),
  );
  const generatedImportLines = generatedContent.split('\n').filter((l) => importLine.test(l.trim()));
  const missing = generatedImportLines.filter((l) => {
    if (existingImports.has(l.trim())) return false;
    const fqcn = importLine.exec(l.trim())[1];
    const simpleName = fqcn.split('.').pop();
    return addedText.includes(simpleName);
  });
  if (missing.length === 0) return content;

  const lines = content.split('\n');
  let lastImportIdx = -1;
  lines.forEach((l, i) => {
    if (importLine.test(l.trim())) lastImportIdx = i;
  });
  if (lastImportIdx === -1) return content; // no import block to anchor to; skip
  lines.splice(lastImportIdx + 1, 0, ...missing.map((l) => l.trim()));
  return lines.join('\n');
}

// ---- orchestration ------------------------------------------------------------

/**
 * Detect stale member bodies on a GENERATED file.
 *
 * The add-only merge only ever ADDS missing members; it cannot see a member that
 * already exists on disk but whose BODY no longer matches what fresh generation
 * would emit (signature unchanged, implementation drift — the classic
 * `StateProjector.apply` case). This is the one kind of drift the merge silently
 * tolerates and `--check` has never caught.
 *
 * Two members are the same SLOT (same identity key) but DRIFTED when their full
 * source differs excluding their leading `//` comment block (so a reworded
 * comment is not drift).
 *
 * @returns array of strings describing each drifted member, or [] if none.
 */
export function semanticDrift(existingContent, generatedContent) {
  // Compare the members INSIDE the top-level type's body (like mergeMembers
  // does), not the file as a whole — a whole-file split collapses the interface
  // into one giant member and flags everything.
  const existingSplit = splitFile(existingContent);
  const generatedSplit = splitFile(generatedContent);
  if (!existingSplit || !generatedSplit) return [];

  // Comments are masked so a hand-reworded javadoc is not body drift.
  const stripComment = (m) => maskComments(m).trim();

  const generatedByKey = new Map();
  for (const m of splitTopLevelMembers(generatedSplit.body)) {
    const k = memberKey(m);
    // Prefer the first occurrence (overloads share a key only by accident here).
    if (!generatedByKey.has(k)) generatedByKey.set(k, m);
  }

  const drift = [];
  for (const existing of splitTopLevelMembers(existingSplit.body)) {
    const k = memberKey(existing);
    const generated = generatedByKey.get(k);
    // No same-slot member in fresh output, or it's identical -> not drift.
    if (!generated || stripComment(existing) === stripComment(generated)) continue;
    drift.push(k);
  }
  return drift;
}

/**
 * @returns {{content: string, added: string[]} | null} null means "don't know
 * how to merge this shape safely" — caller must not overwrite.
 */
export function mergeGenerated(existingContent, generatedContent) {
  if (existingContent === generatedContent) return { content: existingContent, added: [] };

  const existingSplit = splitFile(existingContent);
  const generatedSplit = splitFile(generatedContent);
  if (!existingSplit || !generatedSplit) return null;

  const added = [];
  let prefix = existingSplit.prefix;
  let body = existingSplit.body;

  const recordMerge = mergeRecordComponents(existingSplit.prefix, generatedSplit.prefix);
  if (recordMerge) {
    prefix = recordMerge.prefix;
    added.push(...recordMerge.added);
  }

  const enumMerge = mergeEnumConstants(existingSplit.prefix, existingSplit.body, generatedSplit.body);
  if (enumMerge) {
    body = enumMerge.body;
    added.push(...enumMerge.added);
  } else {
    const memberMerge = mergeMembers(existingSplit.body, generatedSplit.body);
    body = memberMerge.body;
    added.push(...memberMerge.added);
  }

  if (added.length === 0) return { content: existingContent, added: [] };

  let content = `${prefix}${body}${existingSplit.suffix}`;
  content = mergeImports(content, generatedContent, added.join(' '));

  // Last line of defence. If our structural assumptions were wrong anywhere
  // above, the result is a file that does not compile — and it would be written
  // silently, with `--check` reporting "up to date" ever after. Refuse instead.
  if (!isWellFormed(content)) return null;
  return { content, added };
}

export {
  memberKey,
  splitTopLevelMembers,
  splitFile,
};

