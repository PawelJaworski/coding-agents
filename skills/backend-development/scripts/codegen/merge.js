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
 */
function splitTopLevelMembers(body) {
  const members = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
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
  const mapping = MAPPING_ANNOTATION_RE.exec(member);
  if (mapping) return `${mapping[1]}Mapping(${mapping[2].replace(/\s+/g, ' ').trim()})`;

  let idx = member.length;
  for (let i = 0; i < member.length; i++) {
    if (member[i] === '{' || member[i] === ';') {
      idx = i;
      break;
    }
  }
  const header = member
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

/** First top-level `{` opens the type body; the matching last `}` closes it. */
function splitFile(content) {
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
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
  return { content, added };
}
