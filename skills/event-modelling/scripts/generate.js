#!/usr/bin/env node
/*
 * Event Modeling diagram generator.
 *
 * Reads commands.md / events.md / readmodels.md (per the format documented
 * in ../SKILL.md) and writes a single self-contained HTML file implementing
 * the canonical Event Modeling layout: swimlane table + SVG arrow overlay.
 *
 * Usage:
 *   node generate.js [inputDir] [outputFile]
 *
 *   inputDir   defaults to "."   (must contain commands.md, events.md, readmodels.md)
 *   outputFile defaults to "<inputDir>/eventmodel.html"
 *
 * No dependencies beyond Node's built-in fs/path.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.join(__dirname, '..');
const INTERACTIVITY_JS = path.join(SKILL_DIR, 'reference', 'interactivity.js');
const LAYOUT_JS = path.join(SKILL_DIR, 'scripts', 'layout.js');

// ---------------------------------------------------------------------------
// 1. Parse markdown inputs
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1a. GWT (Given-When-Then) file discovery and parsing
// ---------------------------------------------------------------------------

// Discover GWT files for read models: looks for gwt-{read-model-id}.md files
// in the input directory. Returns a map of read model id -> parsed GWT data.
function discoverGwtFiles(inputDir, readmodelIds) {
  const gwtData = {};
  
  for (const rmId of readmodelIds) {
    const gwtFile = path.join(inputDir, `gwt-${rmId}.md`);
    if (fs.existsSync(gwtFile)) {
      const content = fs.readFileSync(gwtFile, 'utf8');
      gwtData[rmId] = parseGwtContent(content, rmId);
    }
  }
  
  return gwtData;
}

// Parse GWT content in Option B format (detailed GWT with multiple scenarios)
function parseGwtContent(content, readmodelId) {
  const lines = content.split('\n');
  const scenarios = [];
  let currentScenario = null;
  let currentSection = null; // Track which section we're in: 'given', 'when', 'then', or null
  let title = `GWT: ${readmodelId}`;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Extract title from # heading
    const titleMatch = trimmed.match(/^#\s+(.+)/);
    if (titleMatch) {
      title = titleMatch[1];
      continue;
    }
    
    // Scenario heading: ## Scenario N: Name or ## descriptive name
    const scenarioMatch = trimmed.match(/^##\s+(.+)/);
    if (scenarioMatch) {
      if (currentScenario) {
        scenarios.push(currentScenario);
      }
      currentScenario = {
        name: scenarioMatch[1],
        given: [],
        when: [],
        then: []
      };
      currentSection = null; // Reset section when starting new scenario
      continue;
    }
    
    if (!currentScenario) continue;
    
    // Parse GWT sections - support both formats:
    // Format 1: **Given** text (bold, uppercase)
    // Format 2: given: (lowercase with colon)
    
    // Check for Given section
    const givenMatchBold = trimmed.match(/^\*\*Given\*\*\s+(.+)/i);
    const givenMatchColon = trimmed.match(/^given:\s*$/i);
    if (givenMatchBold || givenMatchColon) {
      currentSection = 'given';
      if (givenMatchBold) {
        currentScenario.given.push(givenMatchBold[1]);
      }
      continue;
    }
    
    // Check for When section
    const whenMatchBold = trimmed.match(/^\*\*When\*\*\s+(.+)/i);
    const whenMatchColon = trimmed.match(/^when:\s*$/i);
    if (whenMatchBold || whenMatchColon) {
      currentSection = 'when';
      if (whenMatchBold) {
        currentScenario.when.push(whenMatchBold[1]);
      }
      continue;
    }
    
    // Check for Then section
    const thenMatchBold = trimmed.match(/^\*\*Then\*\*\s+(.+)/i);
    const thenMatchColon = trimmed.match(/^then:\s*$/i);
    if (thenMatchBold || thenMatchColon) {
      currentSection = 'then';
      if (thenMatchBold) {
        currentScenario.then.push(thenMatchBold[1]);
      }
      continue;
    }
    
    // Add content to current section (support both bullet points and plain text)
    if (currentSection && trimmed) {
      // Remove bullet point prefix if present
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
      const content = bulletMatch ? bulletMatch[1] : trimmed;
      
      switch (currentSection) {
        case 'given':
          currentScenario.given.push(content);
          break;
        case 'when':
          currentScenario.when.push(content);
          break;
        case 'then':
          currentScenario.then.push(content);
          break;
      }
    }
  }
  
  // Push the last scenario
  if (currentScenario) {
    scenarios.push(currentScenario);
  }
  
  return {
    title,
    scenarios
  };
}

// Check if a GWT file exists for a read model
function hasGwtFile(inputDir, readmodelId) {
  const gwtFile = path.join(inputDir, `gwt-${readmodelId}.md`);
  return fs.existsSync(gwtFile);
}

function parseMd(file) {
  const text = fs.readFileSync(file, 'utf8');
  return parseMdText(text);
}

// Parses markdown text (same format as parseMd, but takes the raw string
// directly rather than a file path) — extracted so it's unit-testable
// without touching the filesystem.
function parseMdText(text) {
  const lines = text.split('\n');
  const items = [];
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^##\s+(.+)/);
    if (h) {
      cur = { id: h[1].trim() };
      items.push(cur);
      continue;
    }
    if (!cur) continue;
    // Key names may contain spaces (e.g. "System name:") — the key is
    // lowercased for the switch below. Bare field bullets (no colon) are
    // handled separately after this.
    const kv = line.match(/^\s*(?:-\s*)?([A-Za-z][A-Za-z0-9 -]*?)\s*:\s*(.+)/);
    if (kv) {
      const rawKey = kv[1].trim();
      const val = kv[2].trim();
      // Aggregate-id attribute: "aggregateName:Id", e.g. "policy:Id" — the
      // LHS (in camelCase) is the aggregate name, the RHS is the literal
      // suffix "Id". Checked before the generic switch below since the LHS
      // is arbitrary (not one of the fixed known attribute names).
      if (val === 'Id') {
        cur.aggregateId = rawKey;
        continue;
      }
      // Read-model-only attribute: one or more repeatable "keyName:Key" /
      // "keyName:RowKey" lines declaring a projection key, e.g.
      // "policyNumber:Key" or "policy:RowKey". Parsed generically here (same
      // as ":Id") but only meaningful/rendered/enforced on read models — see
      // buildModel's hard-error check and renderTable. If it shows up on a
      // command or event, it's silently ignored (same tier as any other
      // attribute that isn't meaningful for that file's shape).
      //
      // The suffix is kept on each entry and rendered as written: ":Key" is
      // the single-record persisting projection, ":RowKey" the row-keyed list
      // one (see SKILL.md). The diagram never normalises one into the other.
      if (val === 'Key' || val === 'RowKey') {
        (cur.keys || (cur.keys = [])).push({ name: rawKey, mode: val });
        continue;
      }
      const key = rawKey.toLowerCase();
      switch (key) {
        case 'name': cur.name = val; break;
        case 'actor':
          // Comma-separated actor names (`Actor: A, B`); `actor` keeps the raw
          // line, `actors` the parsed list (one name = one-element list).
          cur.actor = val;
          cur.actors = val.split(',').map((s) => s.trim()).filter(Boolean);
          break;
        case 'type':
          // Free-form display hint — value can be anything (no enum). Used by
          // uis.md (html, pdf, ...) and translators.md (whatever the team calls
          // that bot). Purely a card label; it never affects linkage.
          cur.typeHint = val;
          break;
        case 'produces':
          // Comma-separated list of event ids this command triggers — one
          // command may emit several events (e.g. `Produces: policy-issued,
          // premium-calculated`), rendered as a single command card producing
          // each event (see buildModel / renderArrows).
          cur.produces = val.split(',').map((s) => s.trim()).filter(Boolean);
          break;
        case 'observes': cur.observes = val; break;
        case 'triggers':
          // Comma-separated list of command ids this single UI card triggers.
          // Rendering fans this out into one visual UI box per command (see
          // buildModel/renderTable/renderArrows) while the markdown stays a
          // single "## heading" entry.
          cur.triggers = val.split(',').map((s) => s.trim()).filter(Boolean);
          break;
        case 'subprocess': cur.subprocess = val; break;
        case 'system name': cur.systemName = val; break;
        case 'subscribes':
          cur.subscribes = val.split(',').map((s) => s.trim()).filter(Boolean);
          break;
        case 'consistsof':
          cur.consistsOf = val.split(',').map((s) => s.trim()).filter(Boolean);
          break;
        case 'url':
          // Optional external URL — when present the UI card on the diagram
          // is rendered as a clickable link to this address (see layout.js
          // renderTable for the rendering logic).
          cur.url = val;
          break;
        default: break; // unknown "key: value" — ignore
      }
      continue;
    }
    // A bare bullet ("* field" / "- field", no colon) is a field/parameter
    // shown on the card, e.g. the payload of a read model or event.
    // A trailing "?" marks a search criterion answerable by a direct DB
    // query — it's a real passthrough field, so it's stripped for display
    // immediately here and still fully subject to the passthrough-match
    // check below. A trailing "??" marks a read-model-only search criterion
    // that is NOT derived from any upstream event — it belongs solely to the
    // read model (e.g. implemented via backend logic over data the read
    // model already has some other way), so it is kept intact here (not
    // stripped) and only stripped for display later, at render time — see
    // isDoubleQuestionField below, which exempts it from the passthrough
    // check the same way [...] does.
    const field = line.match(/^\s*(\*(?:\s+\*)*|-)\s+(.+)/);
    if (field) {
      const marker = field[1];
      const depth = marker === '-' ? 1 : marker.split(/\s+/).length;
      let fieldName = field[2].trim();
      if (!fieldName.endsWith('??') && fieldName.endsWith('?')) fieldName = fieldName.slice(0, -1).trim();
      const tree = {
        name: fieldName.replace(/\s+\(list\)$/i, '').trim(),
        list: /\s+\(list\)$/i.test(fieldName),
        children: [],
      };
      if (depth === 1) {
        (cur.fieldTrees || (cur.fieldTrees = [])).push(tree);
      } else {
        const parent = lastFieldAtDepth(cur.fieldTrees || [], depth - 1);
        if (!parent) {
          throw new Error(`Nested field "${line.trim()}" has no parent at depth ${depth - 1}.`);
        }
        parent.children.push(tree);
      }
      (cur.fields || (cur.fields = [])).push(`${'  '.repeat(depth - 1)}${fieldName}`);
    }
    // Read-model-only: a standalone "---" line (horizontal-rule syntax) acts
    // as a request/response divider.  It is stored as a sentinel in BOTH
    // `fields` and `fieldTrees` so that buildModel can split each list at the
    // same marker.  For non-read-model files the sentinel is never consulted.
    if (/^---\s*$/.test(line.trim())) {
      (cur.fields || (cur.fields = [])).push('---');
      (cur.fieldTrees || (cur.fieldTrees = [])).push({ name: '---', list: false, children: [] });
    }
  }

  function lastFieldAtDepth(fields, depth) {
    let level = fields;
    let parent = null;
    for (let i = 0; i < depth; i += 1) {
      parent = level.at(-1);
      if (!parent) return null;
      level = parent.children;
    }
    return parent;
  }
  return items;
}

// ---------------------------------------------------------------------------
// 1b. Field consistency helpers
// ---------------------------------------------------------------------------

// A field wrapped in [...] is an explicitly-documented deviation (calculated
// or system-generated, not a direct passthrough from upstream) — see
// "Diagram consistency" in SKILL.md. It is exempt from the match check below.
function isBracketedField(f) {
  const t = String(f).trim();
  return t.startsWith('[') && t.endsWith(']');
}

// A field with a trailing "??" is a read-model-only search criterion with no
// upstream event field — see "Diagram consistency" in SKILL.md. Like [...],
// it is exempt from the match check below. Unlike [...], the marker is
// stripped for display (see fieldsHtml) rather than rendered literally.
function isDoubleQuestionField(f) {
  return String(f).trim().endsWith('??');
}

// Strip a trailing "??" for display purposes (the marker itself is never
// shown on the card — only [...] renders literally).
function stripDoubleQuestion(f) {
  const t = String(f).trim();
  return isDoubleQuestionField(t) ? t.slice(0, -2).trim() : t;
}

// Normalize a field for comparison: trim, strip an enclosing [...]
// wrapper (so "[policy number]" and "policy number" are considered the same
// field), lowercase. Simple case-insensitive exact-string match — no fuzzy
// matching. (A trailing "?" is already stripped at parse time, before this
// is ever called; a trailing "??" is exempt from matching entirely — see
// isDoubleQuestionField.)
function normalizeField(f) {
  let t = String(f).trim();
  if (isBracketedField(t)) t = t.slice(1, -1).trim();
  return t.toLowerCase();
}

function hasMatchingField(field, upstreamFieldsList) {
  const target = normalizeField(field);
  return upstreamFieldsList.some((fields) => (fields || []).some((f) => normalizeField(f) === target));
}

function hasMatchingStructuredField(field, upstreamTrees) {
  return upstreamTrees.some((trees) => (trees || []).some((candidate) =>
    normalizeField(candidate.name) === normalizeField(field.name) && hasSameFieldShape(field, candidate),
  ));
}

function hasSameFieldShape(left, right) {
  if (left.list !== right.list || left.children.length !== right.children.length) return false;
  return left.children.every((child, index) =>
    normalizeField(child.name) === normalizeField(right.children[index].name) && hasSameFieldShape(child, right.children[index]),
  );
}

// A "pure flattening" is a scalar field whose name is an upstream structured
// field's name followed by a child path within it — e.g. event
// `product (List)` {code, name, description} → read model `product code`.
// The generator recognises this as a per-element/element-attribute passthrough
// (dereferencing the list) and does NOT treat it as guessing: no renaming,
// aggregation, filtering or reordering is involved — the flat name is the exact
// concatenation of the root field name and child names. Deeper paths may
// descend through plain (non-list) objects, but a target that is itself a
// (List) or a structured object with children is not a pure flattening, and a
// second (List) level cannot be descended through — both still require a
// modelling decision.
function isPureFlattening(field, upstreamTrees) {
  if (field.list) return false; // a (List)/nested column isn't a scalar flattening
  const tokens = normalizeField(field.name).split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  return (upstreamTrees || []).some((trees) =>
    (trees || []).some((root) => {
      if (!root.children || !root.children.length) return false;
      const rootTokens = normalizeField(root.name).split(/\s+/).filter(Boolean);
      if (tokens.length <= rootTokens.length) return false;
      for (let i = 0; i < rootTokens.length; i += 1) if (tokens[i] !== rootTokens[i]) return false;
      let nodes = root.children;
      const rest = tokens.slice(rootTokens.length);
      for (let i = 0; i < rest.length; i += 1) {
        const node = nodes.find((c) => normalizeField(c.name) === rest[i]);
        if (!node) return false;
        if (i === rest.length - 1) {
          // the final token must be a leaf — a scalar projection column
          return !node.list && (!node.children || !node.children.length);
        }
        // intermediate tokens descend only through a plain structured object
        if (node.list || !node.children || !node.children.length) return false;
        nodes = node.children;
      }
      return false;
    }),
  );
}

// Check if a field is a transformation of a special :Id/:Key/:RowKey attribute.
// e.g., "policy id" is a transformation of "policy:Id"
// e.g., "customer key" is a transformation of "customer:Key" and "customer:RowKey"
// The transformation is: camelCase → space-separated + " id" or " key" suffix.
// Both key markers inject an identity named "<name> key" — ":RowKey" speaks
// about cardinality (a list of rows), not the name of the key — so "customer
// row key" is NOT a transformation; the field is always "customer key".
function isTransformationOfSpecialAttribute(field, aggregateId, keys) {
  const normalizedField = normalizeField(field);
  
  // Helper to convert camelCase to space-separated
  const camelToSpace = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  
  // Check if it's a transformation of :Id
  if (aggregateId) {
    const spacedAggregateId = camelToSpace(aggregateId);
    // "attribute id" matches "attribute:Id"
    if (normalizedField === `${spacedAggregateId} id`) return true;
  }
  
  // Check if it's a transformation of :Key / :RowKey
  if (keys && keys.length) {
    for (const key of keys) {
      const spacedKey = camelToSpace(key.name);
      // "attribute key" matches "attribute:Key" and "attribute:RowKey"
      if (normalizedField === `${spacedKey} key`) return true;
    }
  }
  
  return false;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// 1c. Ubiquitous-language check against docs/business-definitions.html
// ---------------------------------------------------------------------------

// Walk up from inputDir looking for docs/business-definitions.html — this
// lets the generator find the project's docs regardless of how deep
// inputDir is nested.
function findBusinessDefinitions(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, 'docs', 'business-definitions.html');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Extracts every defined term name, lowercased, from the definitions page's
// `data-name="..."` attributes.
function loadDefinedTerms(inputDir) {
  const file = findBusinessDefinitions(inputDir);
  if (!file) return null; // no docs found — skip the check rather than guess
  const html = fs.readFileSync(file, 'utf8');
  const terms = new Set();
  const re = /data-name="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) terms.add(m[1].trim().toLowerCase());
  return terms;
}

// `Actor: A, B` names one actor GROUP: de-duplicated, order-insensitive for
// identity (so `A, B` and `B, A` share one swimlane); display keeps the
// order written on the line that first introduced the group.
function normalizeActors(actors) {
  const out = [];
  (actors || []).forEach((a) => { if (a && !out.includes(a)) out.push(a); });
  return out;
}

// Placement key of an actor group — same key = same swimlane.
function actorGroupKey(actors) {
  return normalizeActors(actors).slice().sort().join(' | ');
}

// Non-blocking: warn (don't throw) about commands' effective actors (from
// uis.md) that aren't documented in docs/business-definitions.html.
// Ubiquitous-language drift here is a business-intent question, not
// something the generator should silently accept or silently block on —
// surface it and require a human to confirm before it's treated as final.
// Each name on a multi-actor `Actor:` line is checked on its own.
function checkActorsAgainstDefinitions(commands, inputDir) {
  const terms = loadDefinedTerms(inputDir);
  if (!terms) return;
  const actors = new Set();
  commands.forEach((c) => (c.actors || []).forEach((a) => actors.add(a)));
  const undefinedActors = [...actors].filter((a) => !terms.has(a.toLowerCase()));
  if (undefinedActors.length) {
    console.warn(
      `Warning: actor(s) not found in docs/business-definitions.html — ${undefinedActors.join(', ')}. ` +
      `This may be intended (e.g. a role not worth documenting) or a ubiquitous-language mismatch — ` +
      `please confirm before treating the model as final.`
    );
  }
}


// ---------------------------------------------------------------------------
// 2. Build the model: columns, mid-row occupancy, swimlanes
// ---------------------------------------------------------------------------

function buildModel(inputDir) {
  const commands = parseMd(path.join(inputDir, 'commands.md'));
  const events = parseMd(path.join(inputDir, 'events.md'));
  const readmodels = parseMd(path.join(inputDir, 'readmodels.md'));
  const uisFile = path.join(inputDir, 'uis.md');
  const uis = fs.existsSync(uisFile) ? parseMd(uisFile) : [];
  // Translation Pattern inputs (both optional — a model may have no external
  // integration): external-events.md describes facts that happen in systems
  // we don't own (no mandatory {aggregate}:Id, no producing command — they
  // arrive from outside); translators.md declares the "bots" that subscribe
  // to those external events and issue internal commands in response.
  const externalEventsFile = path.join(inputDir, 'external-events.md');
  const externalEvents = fs.existsSync(externalEventsFile) ? parseMd(externalEventsFile) : [];
  const translatorsFile = path.join(inputDir, 'translators.md');
  const translators = fs.existsSync(translatorsFile) ? parseMd(translatorsFile) : [];

  // uis.md links to a command or a read model(s) by sharing its id, or via
  // an explicit `ConsistsOf:` list:
  //  - a UI whose id matches a command  -> the human trigger for that command
  //    (input UI, rendered above the command, in the role row of `Actor:`).
  //  - a UI whose id matches a read model, and/or lists read model ids in
  //    `ConsistsOf:` -> the rendered output of that view (or views), e.g. a
  //    pdf/html screen composed from several projections. Rendered in the
  //    row of `Actor:` — the person who receives/reads it — placed in the
  //    rightmost source read model's column, with one arrow per source.
  // `Type:` (html, pdf, ...) is a free-form display hint only; linkage is by id.
  const uiById = {};
  uis.forEach((u) => {
    u.actors = normalizeActors(u.actors);
    u.actorKey = u.actors.length ? actorGroupKey(u.actors) : undefined;
    uiById[u.id] = u;
  });
  const commandIds = new Set(commands.map((c) => c.id));
  const readmodelIds = new Set(readmodels.map((r) => r.id));

  // Which UI(s) trigger which command. By default a UI's own id is the
  // trigger link (its id equals the command's id), same as before. An
  // explicit `Triggers: <command-id>[, <command-id>...]` overrides this — it
  // lets the UI heading use its own descriptive id (e.g. "order-intake-form")
  // instead of having to match the command id exactly, while still wiring it
  // to that command as its human trigger. A single UI may list several
  // command ids: the markdown stays one "## heading" entry, but each listed
  // command gets wired to (and, in the rendered diagram, gets its own visual
  // box for) that same UI — see renderTable/renderArrows below, which key
  // off the command's own column, so one entry naturally fans out into N
  // boxes without further bookkeeping here.
  //
  // Conversely, more than one UI may legitimately trigger the *same*
  // command — this is fan-in: two different scenarios/entry points that
  // both end up issuing the same command. E.g. an explicit `Triggers:`
  // claim from one UI and an id-match claim from another UI with the same
  // id as the command can coexist. This is not an error: every UI that
  // has a real claim on a command is a distinct trigger candidate, and
  // renderTable/renderArrows render one visual box per triggering UI in
  // that command's column, side by side, each with its own arrow.
  const triggerUiForCommand = {}; // commandId -> [ui, ui, ...] (dedup by ui.id)
  const addTrigger = (cmdId, ui) => {
    const list = triggerUiForCommand[cmdId] || (triggerUiForCommand[cmdId] = []);
    if (!list.some((u) => u.id === ui.id)) list.push(ui);
  };
  uis.forEach((u) => {
    if (u.triggers && u.triggers.length) {
      u.triggers.forEach((tid) => {
        if (!commandIds.has(tid)) {
          throw new Error(
            `UI "${u.id}" Triggers: references unknown command id "${tid}".`
          );
        }
        addTrigger(tid, u);
      });
    } else if (commandIds.has(u.id)) {
      // This UI's own id matches a command id — an id-match auto-trigger
      // candidate. Coexists with any other UI(s) already triggering the
      // same command (explicit Triggers: or another id-match) — fan-in,
      // not a conflict.
      addTrigger(u.id, u);
    }
  });
  // Sanity: all UIs fanning into the same command must share the same
  // actor group — a command's role-row placement is keyed by a single actor
  // swimlane, so conflicting actors across triggering UIs would be ambiguous
  // and must be surfaced rather than guessed at (e.g. silently picking the
  // first). Group equality is set-based: `A, B` matches `B, A`.
  Object.keys(triggerUiForCommand).forEach((cmdId) => {
    const list = triggerUiForCommand[cmdId];
    const actorGroups = new Set(list.map((u) => u.actorKey));
    if (actorGroups.size > 1) {
      throw new Error(
        `Command "${cmdId}" is triggered by UIs with different actors — ${list.map((u) => `${u.id}:${u.actor || '(none)'}`).join(', ')}. ` +
        `All UIs triggering the same command must share the same Actor: (same actors, any order).`
      );
    }
  });

  // Sanity: every `ConsistsOf:` entry must reference a real read model id.
  uis.forEach((u) => {
    const bad = (u.consistsOf || []).filter((id) => !readmodelIds.has(id));
    if (bad.length) {
      throw new Error(
        `UI "${u.id}" ConsistsOf: references unknown read model id(s) — ${bad.join(', ')}.`
      );
    }
  });

  // The set of read models an output UI is projected from: itself (if its id
  // matches a read model) plus everything in ConsistsOf, deduped.
  const uiSources = {}; // uiId -> [readmodel ids]
  uis.forEach((u) => {
    const set = new Set();
    if (readmodelIds.has(u.id)) set.add(u.id);
    (u.consistsOf || []).forEach((id) => set.add(id));
    if (set.size) uiSources[u.id] = [...set];
  });

  // A UI whose id matches neither a command nor a read model, and which
  // declares no Triggers: (already validated above) and no ConsistsOf:
  // (already validated above), is not an error — it's a genuinely
  // standalone/placeholder UI (see "Standalone UIs are supported and always
  // rendered" in SKILL.md). It's collected into `standaloneUis` below and
  // rendered in its own dashed-border "Unwired UIs" row instead of being
  // wired into any slice.

  // Commands no longer carry `Actor:` themselves — that's a hard error now,
  // to keep a single source of truth. Human commands get their actor from a
  // matching uis.md entry; automated commands are identified by `Observes:`
  // (see hasSystem below), not by an actor label.
  const commandsWithInlineActor = commands.filter((c) => c.actor);
  if (commandsWithInlineActor.length) {
    throw new Error(
      `Command(s) with an inline "Actor:" in commands.md — ${commandsWithInlineActor.map((c) => c.id).join(', ')}. ` +
      `Commands no longer carry Actor: directly; move it to a matching "## ${commandsWithInlineActor[0].id}" entry in uis.md instead.`
    );
  }
  // A human command inherits its actor group (raw `actor` + parsed list/key)
  // from its triggering UI.
  commands.forEach((c) => {
    const src = triggerUiForCommand[c.id] ? triggerUiForCommand[c.id][0] : undefined;
    c.actor = src ? src.actor : undefined;
    c.actors = src ? src.actors : undefined;
    c.actorKey = src ? src.actorKey : undefined;
  });

  commands.forEach((c) => { if (!c.name) c.name = c.id; c._h = cardHeight(c.aggregateId ? CMD_H + AGG_ID_H : CMD_H, c.fields); });
  const defaultSubprocess = (events[0] && events[0].subprocess) || 'Default';
  events.forEach((e) => {
    if (!e.name) e.name = e.id;
    if (!e.subprocess) e.subprocess = defaultSubprocess;
    e._h = cardHeight(EVT_H, e.fields);
  });
  readmodels.forEach((r) => {
    if (!r.name) r.name = r.id;
    // Split fields at the "---" sentinel (request/response divider).
    // Fields before --- → request fields (no passthrough check).
    // Fields after --- → response fields (same passthrough rules as before).
    const dividerIdx = (r.fields || []).indexOf('---');
    if (dividerIdx !== -1) {
      r.requestFields = (r.fields || []).slice(0, dividerIdx);
      r.responseFields = (r.fields || []).slice(dividerIdx + 1);
      // Also split fieldTrees at the divider.
      const treeDividerIdx = (r.fieldTrees || []).findIndex((t) => t.name === '---');
      if (treeDividerIdx !== -1) {
        r.requestFieldTrees = (r.fieldTrees || []).slice(0, treeDividerIdx);
        r.responseFieldTrees = (r.fieldTrees || []).slice(treeDividerIdx + 1);
      } else {
        r.requestFieldTrees = [];
        r.responseFieldTrees = r.fieldTrees || [];
      }
    } else {
      r.requestFields = [];
      r.responseFields = r.fields || [];
      r.requestFieldTrees = [];
      r.responseFieldTrees = r.fieldTrees || [];
    }
    const idKeyLines = (r.aggregateId ? 1 : 0) + (r.keys ? r.keys.length : 0);
    r._h = cardHeight(VIEW_H + idKeyLines * AGG_ID_H, r.fields);
  });

  // External events: an external contract, NOT modelled by the team — so
  // {aggregateName}:Id is optional (a foreign system has no local aggregate),
  // no producing command is required (they arrive from outside), and no
  // field-consistency check runs against any command (there is none). The
  // only thing that must exist is a `System name:` grouping, mirroring how
  // internal events use `Subprocess:`.
  const defaultExternalSystem = (externalEvents[0] && externalEvents[0].systemName) || 'External';
  externalEvents.forEach((e) => {
    if (!e.name) e.name = e.id;
    if (!e.systemName) e.systemName = defaultExternalSystem;
    e._h = cardHeight(EXT_EVT_BASE_H + (e.aggregateId ? AGG_ID_H : 0), e.fields);
  });
  // Translators: bots that subscribe to external events and produce internal
  // commands. They get a card each; no :Id (not an aggregate), fields are
  // optional. An optional free-form `Type:` grows the card to fit its label
  // line (same display-hint treatment as a UI's Type:).
  translators.forEach((t) => {
    if (!t.name) t.name = t.id;
    t._h = cardHeight(TR_H + (t.typeHint ? TR_TYPE_H : 0), t.fields);
  });
  const hasBots = translators.length > 0;

  const eventProducer = {}; // eventId -> command
  commands.forEach((c) => { (c.produces || []).forEach((pid) => { eventProducer[pid] = c; }); });

  // Sanity: every id in a command's `Produces:` list must reference a real
  // event in events.md (structural rule, same tier as the orphan-event check
  // below — a typo would otherwise silently orphan the real events).
  commands.forEach((c) => {
    (c.produces || []).forEach((pid) => {
      if (!events.some((e) => e.id === pid)) {
        throw new Error(
          `Command "${c.id}" produces unknown event "${pid}" — every id in "Produces:" must match an event in events.md.`
        );
      }
    });
  });

  // Sanity: every event must have a producing command (canonical rule).
  const orphanEvents = events.filter((e) => !eventProducer[e.id]);
  if (orphanEvents.length) {
    throw new Error(
      `Orphan event(s) with no Produces: link — ${orphanEvents.map((e) => e.id).join(', ')}`
    );
  }

  // Sanity: every event must declare its owning aggregate via
  // {aggregateName}:Id (see SKILL.md "Diagram consistency" — mandatory
  // aggregate-id attribute). This is a hard blocker, same tier as the
  // orphan-event check.
  const eventsMissingId = events.filter((e) => !e.aggregateId);
  if (eventsMissingId.length) {
    throw new Error(
      `Event(s) missing mandatory "{aggregateName}:Id" — ${eventsMissingId.map((e) => e.id).join(', ')}. ` +
      `Add e.g. "policy:Id" to declare which aggregate the event belongs to.`
    );
  }

  // Sanity: every read model must declare at least one identifying line —
  // either `{aggregateName}:Id` and/or one or more `{keyName}:Key` /
  // `{keyName}:RowKey` lines. This is a hard blocker, same tier as the
  // orphan-event / missing-event-id checks.
  const readmodelsMissingIdOrKey = readmodels.filter((r) => !r.aggregateId && !(r.keys && r.keys.length));
  if (readmodelsMissingIdOrKey.length) {
    throw new Error(
      `Read model(s) missing mandatory "{aggregateName}:Id" and/or "{keyName}:Key|RowKey" — ${readmodelsMissingIdOrKey.map((r) => r.id).join(', ')}. ` +
      `Add e.g. "policy:Id", "policy:Key" (single-record persisting) or "policy:RowKey" (row-keyed list persisting) — and/or one or more "{keyName}:Key" lines — to declare how the read model is identified.`
    );
  }

  // Sanity: translators (Translation Pattern) wire external events to
  // internal commands. Every `Subscribes:` id must be a real external event,
  // and every `Produces:` id must be a real command — a typo would silently
  // orphan the external event or leave a translator dangling. Also, only
  // translators may reference external event ids: internal events, read
  // models, and UIs must never subscribe to an external event (the bridge
  // into the external world is exactly what translators are for).
  const externalEventIds = new Set(externalEvents.map((e) => e.id));
  const translatorSubscribedExternal = new Set();
  translators.forEach((t) => {
    (t.subscribes || []).forEach((eid) => {
      if (!externalEventIds.has(eid)) {
        throw new Error(
          `Translator "${t.id}" subscribes to unknown external event "${eid}" — every id in "Subscribes:" in translators.md must match an external event in external-events.md.`
        );
      }
      translatorSubscribedExternal.add(eid);
    });
    (t.produces || []).forEach((cid) => {
      if (!commandIds.has(cid)) {
        throw new Error(
          `Translator "${t.id}" produces unknown command "${cid}" — every id in "Produces:" in translators.md must match a command in commands.md.`
        );
      }
    });
  });
  // A translator that produces nothing (or is never triggered by anything)
  // would be an empty card; require at least one Subscribes and one Produces.
  translators.forEach((t) => {
    if (!(t.subscribes || []).length) {
      throw new Error(
        `Translator "${t.id}" subscribes to no external event — a translator must declare at least one "Subscribes:" external event.`
      );
    }
    if (!(t.produces || []).length) {
      throw new Error(
        `Translator "${t.id}" produces no command — a translator must declare at least one "Produces:" command.`
      );
    }
  });
  // Every external event must be consumed by at least one translator (same
  // tier as the orphan-event check — an external event nobody listens to is
  // just noise in the diagram).
  const unconsumedExternal = externalEvents.filter((e) => !translatorSubscribedExternal.has(e.id));
  if (unconsumedExternal.length) {
    throw new Error(
      `External event(s) with no translator subscribing them — ${unconsumedExternal.map((e) => e.id).join(', ')}. ` +
      `Every external event must be listed in a translator's "Subscribes:" in translators.md.`
    );
  }
  // An external event id must not collide with an internal event id (they
  // render in the same column timeline).
  const internalEventIds = new Set(events.map((e) => e.id));
  const collidingExt = externalEvents.filter((e) => internalEventIds.has(e.id));
  if (collidingExt.length) {
    throw new Error(
      `External event id(s) collide with internal events — ${collidingExt.map((e) => e.id).join(', ')}. ` +
      `External and internal event ids must be globally unique.`
    );
  }

  // Ubiquitous-language check (non-blocking warning, not a hard failure —
  // whether to formally document a term is a business-intent decision).
  checkActorsAgainstDefinitions(commands, inputDir);

  // Discover GWT files for read models
  const gwtData = discoverGwtFiles(inputDir, readmodels.map((r) => r.id));
  readmodels.forEach((rm) => {
    rm.gwt = gwtData[rm.id] || null;
  });

  // Sanity: every non-bracketed event field must trace back to the same
  // field on its producing command (canonical rule, see SKILL.md — "Diagram
  // consistency"). Bracketed fields ([...]) are exempt (calculated/system-
  // generated, intentionally not a direct passthrough).
  events.forEach((e) => {
    const cmd = eventProducer[e.id];
    if (!cmd) return; // already reported as an orphan event above
    (e.fieldTrees || []).forEach((f) => {
      if (isBracketedField(f.name)) return;
      if (!hasMatchingStructuredField(f, [cmd.fieldTrees])) {
        if (isPureFlattening(f, [cmd.fieldTrees])) return;
        const sourceWithSameName = (cmd.fieldTrees || []).some((source) => normalizeField(source.name) === normalizeField(f.name));
        if (sourceWithSameName) {
          throw new Error(
            `Unsupported structured-field mapping for event '${e.id}' field "${f.name}": its (list)/nested "* *" shape differs from command '${cmd.id}'. ` +
              `Add a more detailed mapping prompt; the generator will not guess.`,
          );
        }
        throw new Error(
          `Consistency error: event '${e.id}' field "${f.name}" has no matching field in producing command '${cmd.id}'. ` +
          `If this field is system-generated or calculated (not a direct passthrough), wrap it in [...], e.g. "[${f.name}]". ` +
          `Otherwise add the field to the command's payload.`
        );
      }
    });
  });

  // Sanity: every non-bracketed read-model field must trace back to the same
  // field on at least one of its subscribed events, OR be a transformation of
  // a special :Id/:Key attribute (e.g., "policy id" matches "policy:Id").
  // Fields before a "---" divider are request fields — they are caller-provided
  // input and are NOT subject to the passthrough check.
  readmodels.forEach((rm) => {
    const subEvents = (rm.subscribes || []).map((id) => events.find((e) => e.id === id)).filter(Boolean);
    // Only check response fields (after the "---" divider).
    (rm.responseFieldTrees || []).forEach((f) => {
      if (isBracketedField(f.name)) return;
      if (isDoubleQuestionField(f.name)) return;
      if (hasMatchingStructuredField(f, subEvents.map((e) => e.fieldTrees))) return;
      if (isTransformationOfSpecialAttribute(f.name, rm.aggregateId, rm.keys)) return;
      // Pure flattening of an upstream nested/(List) field is a recognised
      // passthrough (see isPureFlattening) — the generator does not guess
      // renaming, filtering, aggregation or reordering, but a straight
      // child-path flattening needs no guess.
      if (isPureFlattening(f, subEvents.map((e) => e.fieldTrees))) return;
      const sourceWithSameName = subEvents.some((event) =>
        (event.fieldTrees || []).some((source) => normalizeField(source.name) === normalizeField(f.name)),
      );
      const sourceWithRelatedName = subEvents.some((event) =>
        (event.fieldTrees || []).some((source) =>
          normalizeField(f.name).startsWith(`${normalizeField(source.name)} `),
        ),
      );
      if (sourceWithSameName || sourceWithRelatedName) {
        throw new Error(
          `Unsupported structured-field mapping for read model '${rm.id}' field "${f.name}": it is not a recognized pure flattening (direct child path) of any nested "(List)"/"* *" field from a subscribed event. ` +
            `Add a more detailed mapping prompt; the generator will not guess how to rename, filter, aggregate, or reorder nested objects.`,
        );
      }
      throw new Error(
        `Consistency error: read model '${rm.id}' field "${f.name}" has no matching field in any subscribed event. ` +
        `If this field is system-generated or calculated (not a direct passthrough), wrap it in [...], e.g. "[${f.name}]". ` +
        `If it's a read-model-only search criterion with no upstream field at all, mark it "??", e.g. "${f.name}??". ` +
        `Otherwise add the field to the source event's payload.`
      );
    });
  });

  // columns: one per event initially, in chronological (file) order.
  let columns = events.map((e) => ({ type: 'event', eventId: e.id }));

  // A command that produces several events renders exactly ONE card, at the
  // column of its leftmost produced event (events.md order = chronological),
  // so the trigger UI and the first produces-edge stay a clean vertical
  // stack; any later produced events get routed produces-edges from that
  // same card (see renderArrows). The primary event is recorded by id (not
  // column index) — read-model insertion splices view columns in between,
  // so indices shift while event ids stay stable.
  const commandPrimaryEvent = {};
  commands.forEach((cmd) => {
    const prods = cmd.produces || [];
    if (!prods.length) return;
    let best = prods[0];
    let bestIdx = Infinity;
    prods.forEach((pid) => {
      const idx = columns.findIndex((c) => c.type === 'event' && c.eventId === pid);
      if (idx !== -1 && idx < bestIdx) { best = pid; bestIdx = idx; }
    });
    commandPrimaryEvent[cmd.id] = best;
  });

  // midRow[i]: null | {type:'cmd', id} | {type:'view', id} — mirrors columns.
  let midRow = columns.map((c, i) => {
    if (c.type !== 'event') return null;
    const cmd = eventProducer[c.eventId];
    if (!cmd) return null;
    return commandPrimaryEvent[cmd.id] === c.eventId ? { type: 'cmd', id: cmd.id } : null;
  });

  const colIndexForEvent = (eventId) => columns.findIndex((c) => c.type === 'event' && c.eventId === eventId);

  readmodels.forEach((rm) => {
    const subs = rm.subscribes || [];
    if (!subs.length) throw new Error(`Read model "${rm.id}" has no Subscribes:`);
    const idxs = subs.map((s) => {
      const idx = colIndexForEvent(s);
      if (idx === -1) throw new Error(`Read model "${rm.id}" subscribes to unknown event "${s}"`);
      return idx;
    });
    const maxIdx = Math.max(...idxs);
    let naturalIdx = maxIdx + 1;

    // Skip past any read-model columns already placed here (in earlier
    // readmodels.md order) instead of displacing them — this keeps
    // read models sharing the same natural column in file-declaration
    // order, left to right.
    while (naturalIdx < columns.length && columns[naturalIdx].type === 'view') {
      naturalIdx++;
    }

    if (naturalIdx >= columns.length) {
      columns.push({ type: 'view', viewId: null });
      midRow.push(null);
      naturalIdx = columns.length - 1;
    } else if (columns[naturalIdx].type === 'event' || midRow[naturalIdx] != null) {
      // Splice a new column in when the natural slot is already occupied — by
      // a command card in the mid-row, or by an event column whose own
      // command card sits elsewhere (a command producing several events). In
      // both cases the view must go AFTER the occupant, never overwrite it.
      columns.splice(naturalIdx, 0, { type: 'view', viewId: null });
      midRow.splice(naturalIdx, 0, null);
    }
    columns[naturalIdx] = { type: 'view', viewId: rm.id };
    midRow[naturalIdx] = { type: 'view', id: rm.id };
  });

  // External events (Translation Pattern) get one column each, inserted
  // immediately LEFT of the command column they (transitively, via the
  // translators that subscribe to them) feed — never left of the command, per
  // the "never-left-of" convention. Multiple external events feeding the same
  // command land left-to-right in external-events.md order. External event
  // columns are empty in the mid-row and time row (they're not internal
  // events — the external-system lanes at the bottom render the actual cards).
  const extFeedsCommand = {}; // extId -> [cmdId, ...] (dedup)
  const addExtFeed = (eid, cid) => {
    (extFeedsCommand[eid] || (extFeedsCommand[eid] = [])).push(cid);
  };
  translators.forEach((t) => {
    (t.subscribes || []).forEach((eid) => {
      (t.produces || []).forEach((cid) => addExtFeed(eid, cid));
    });
  });
  const extColFor = {}; // extId -> column index
  externalEvents.forEach((e) => {
    const cmds = [...new Set(extFeedsCommand[e.id] || [])];
    let anchor = Infinity;
    cmds.forEach((cid) => {
      const pe = commandPrimaryEvent[cid];
      if (!pe) return;
      const idx = colIndexForEvent(pe);
      if (idx !== -1 && idx < anchor) anchor = idx;
    });
    if (anchor === Infinity) {
      throw new Error(
        `External event "${e.id}" cannot be placed — it feeds no command that has a column. ` +
        `Every translator subscribing it must produce a command that itself produces an event in events.md.`
      );
    }
    columns.splice(anchor, 0, { type: 'ext', extId: e.id });
    midRow.splice(anchor, 0, null);
    extColFor[e.id] = anchor;
  });
  const colIndexForExt = (extId) => columns.findIndex((c) => c.type === 'ext' && c.extId === extId);

  // Translator boxes: one visual card per (translator, produced command) pair,
  // each sitting in the Bots row directly above its produced command's column
  // (mirrors the trigger-UI fan-out convention).
  const translatorElementId = (trId, cmdId) => `tr-${trId}--cmd-${cmdId}`;
  const translatorBoxes = [];
  translators.forEach((t) => {
    (t.produces || []).forEach((cid) => {
      const pe = commandPrimaryEvent[cid];
      if (!pe) return;
      const colIdx = colIndexForEvent(pe);
      if (colIdx === -1) return;
      translatorBoxes.push({ tr: t, cmdId: cid, colIdx, elementId: translatorElementId(t.id, cid) });
    });
  });

  const colIndexForView = (viewId) => columns.findIndex((c) => c.type === 'view' && c.viewId === viewId);
  // Placement column for an output UI: the rightmost column among its source
  // read models (a UI can only be drawn in one column, so composite/multi-
  // view UIs land next to their last-produced input, same convention as
  // read-model placement itself).
  const uiPlacementCol = {};
  Object.keys(uiSources).forEach((uiId) => {
    let bestIdx = -1;
    uiSources[uiId].forEach((rmId) => {
      const idx = colIndexForView(rmId);
      if (idx > bestIdx) bestIdx = idx;
    });
    uiPlacementCol[uiId] = bestIdx;
  });

  // Standalone UIs: a "## heading" in uis.md that never ends up wired into
  // the diagram — its id has NO id-match trigger candidacy (doesn't equal
  // any command id) AND it has NO explicit `Triggers:` claim at all, and it
  // isn't the source of any output view (`uiSources`) either. Any UI that
  // *does* have an id-match or explicit-Triggers claim on a command is
  // handled above — if that claim conflicts with another UI's claim on the
  // same command, it throws rather than silently landing here. Rather than
  // silently dropping genuinely unwired cards, they're still real UI cards
  // from the model and must be rendered somewhere — see the dedicated
  // "Unwired UIs" row in renderTable.
  const wiredAsTrigger = new Set(Object.values(triggerUiForCommand).flat().map((u) => u.id));
  const standaloneUis = uis.filter((u) => !wiredAsTrigger.has(u.id) && !uiSources[u.id]);

  // One swimlane per actor group (`{ key, actors }`), collected in order
  // first encountered from command- and read-model-linked UIs alike — a
  // multi-actor `Actor: A, B` line is ONE row, not two.
  const roles = [];
  const addRole = (actorKey, actors) => {
    if (!actorKey || roles.some((r) => r.key === actorKey)) return;
    roles.push({ key: actorKey, actors });
  };
  commands.forEach((c) => { addRole(c.actorKey, c.actors); });
  uis.forEach((ui) => {
    if (uiSources[ui.id]) addRole(ui.actorKey, ui.actors);
  });
  // A command is automated ("System") when it declares `Observes:` — that's
  // the sole signal now that commands no longer carry an `Actor:` label.
  const hasSystem = commands.some((c) => !!c.observes);

  const subprocesses = [];
  events.forEach((e) => { if (!subprocesses.includes(e.subprocess)) subprocesses.push(e.subprocess); });

  // External-system swimlanes: one per distinct `System name:` in
  // external-events.md order (mirrors how `Subprocess:` builds internal lanes).
  const externalSystems = [];
  externalEvents.forEach((e) => {
    if (!externalSystems.includes(e.systemName)) externalSystems.push(e.systemName);
  });

  return {
    commands, events, readmodels, uis, uiById, triggerUiForCommand, uiSources, uiPlacementCol,
    eventProducer, commandPrimaryEvent, columns, midRow,
    roles, hasSystem, subprocesses, standaloneUis,
    externalEvents, translators, hasBots, externalSystems, extColFor,
    translatorBoxes,
  };
}

// ---------------------------------------------------------------------------
// 3. Geometry + rendering (shared with the browser via scripts/layout.js)
// ---------------------------------------------------------------------------

const LAYOUT = require('./layout.js');
const {
  // sizing constants needed by buildModel (_h) and renderPage (CSS)
  AGG_ID_H, CMD_H, CMD_W, EVT_H, EVT_W, EXT_EVT_BASE_H, EXT_EVT_W, TR_H, TR_W,
  TR_TYPE_H, UI_W, UI_H, VIEW_H, VIEW_W,
  cardHeight,
  // render pipeline
  computeGeometry, renderTable, renderArrows,
} = LAYOUT;

// ---------------------------------------------------------------------------
// 6. Page assembly
// ---------------------------------------------------------------------------

function renderPage(model, geo, tableHtml, arrowsHtml) {
  const script = fs.readFileSync(INTERACTIVITY_JS, 'utf8');
  // The layout engine is inlined VERBATIM (same file generate.js requires),
  // so the browser can re-run the exact same geometry/render pipeline when
  // the focus filter adds/removes cards — see scripts/layout.js header.
  const layoutScript = fs.readFileSync(LAYOUT_JS, 'utf8');
  // Model JSON for the browser re-render. Function-valued properties (none
  // should exist — buildModel keeps the model JSON-serialisable) would be
  // dropped by JSON.stringify, which is why layout.js takes pure functions
  // of the model instead of closures hanging off it.
  const modelJson = JSON.stringify(model);
  
  // Build GWT data for JavaScript
  const gwtDataMap = {};
  model.readmodels.forEach((rm) => {
    if (rm.gwt) {
      gwtDataMap[rm.id] = rm.gwt;
    }
  });
  const gwtDataJson = JSON.stringify(gwtDataMap);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Event Model</title>
<style>
:root{
  --command:#12cdd4;
  --event:#fac710;
  --view:#8fd14f;
  --ink:#0a0a0a;
  --arrow:#333333;
  --read-line:#5E35B1;
  --ext-event:#cfd8dc;
  --translator:#26a69a;
}
*{box-sizing:border-box}
body{margin:0;padding:40px;background:#fafafa;font-family:'OpenSans','Noto Sans',Arial,sans-serif;color:var(--ink)}
.wrap{position:relative;width:${geo.width}px;margin:0 auto;cursor:grab;touch-action:none}
.wrap.is-panning{cursor:grabbing}
table{table-layout:fixed;border-collapse:collapse}
td{padding:0;vertical-align:middle;text-align:center;border:none}
.gutter{font-size:12px;font-weight:600;color:#555;padding:0 10px;text-align:left;vertical-align:middle}
.time-cell{vertical-align:middle}
.time-badge{width:26px;height:26px;border-radius:50%;background:#fff;border:2px solid #333;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin:0 auto}
.sys-gutter{background:#e2e9f5}
.bots-gutter{background:#b2dfdb;color:#004d40}
.bots-cell{background:#e0f2f1}
.mid-gutter{background:#f7f8f9}
.mid-cell{background:#f7f8f9}tr.mid-row td.mid-cell{border-top:2px dashed #bbb;border-bottom:2px dashed #bbb}
.ext-gutter{background:#eceff1;color:#37474f;font-style:italic}
.standalone-gutter{background:#f2f2f2;font-style:italic}
.standalone-cell{background:#fbfbfb;border-bottom:2px dotted #ccc;text-align:left;vertical-align:middle}
.standalone-row{display:flex;flex-wrap:wrap;gap:16px;padding:12px 20px}
.standalone-ui{border-style:dashed}
.ui-fanin-row{display:inline-flex;gap:8px;align-items:center;justify-content:center}
.card{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.15);position:relative;user-select:none}
.card.active{outline:3px solid #333;outline-offset:2px}
.ui-card{width:${UI_W}px;height:${UI_H}px;background:#fff;border:2px solid #ccc}
.ui-label{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.05em}
.cmd-card{width:${CMD_W}px;background:var(--command);color:#eafffb}
.evt-card{width:${EVT_W}px;background:var(--event);color:#8a6408}
.view-card{width:${VIEW_W}px;background:var(--view);color:#35681f}
.ext-card{width:${EXT_EVT_W}px;background:var(--ext-event);color:#37474f;border:2px dashed #90a4ae}
.tr-card{width:${TR_W}px;background:var(--translator);color:#eafffb}
.tr-card .ui-label{color:rgba(234,255,251,.75)}
.title{font-size:13px;font-weight:700;padding:0 8px;text-align:center;flex-shrink:0}
.caption{font-size:10px;opacity:.8;text-transform:uppercase;letter-spacing:.04em}
.actor-lines{display:flex;flex-direction:column;gap:2px}
.agg-id{font-size:10px;font-weight:700;text-align:center;flex-shrink:0}
.fields{width:100%;margin-top:4px;padding:5px 10px 5px;border-top:1px solid rgba(0,0,0,.15)}
.fields ul{list-style:none;margin:0;padding:0}
.fields li{font-size:10px;line-height:14px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fields li::before{content:'•';margin-right:5px;opacity:.6}
.fields-separator{height:1px;margin:4px 0;background:#bbb;border:none}
.sys-badge{position:absolute;top:-10px;font-size:9px;background:#5E35B1;color:#fff;padding:2px 6px;border-radius:10px}
.tr-badge{position:absolute;top:-10px;font-size:9px;background:#004d40;color:#fff;padding:2px 6px;border-radius:10px}
.gwt-badge{position:absolute;bottom:-10px;font-size:9px;background:#2196F3;color:#fff;padding:2px 6px;border-radius:10px;cursor:pointer;z-index:10}
.gwt-badge:hover{background:#1976D2}
svg{position:absolute;top:0;left:0;pointer-events:none}
.gwt-modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;justify-content:center;align-items:center}
.gwt-modal.active{display:flex}
.gwt-modal-content{background:#fff;border-radius:8px;padding:24px;max-width:600px;max-height:80vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3)}
.gwt-modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #eee;padding-bottom:12px}
.gwt-modal-title{font-size:18px;font-weight:700;color:#333}
.gwt-modal-close{background:none;border:none;font-size:24px;cursor:pointer;color:#666;padding:0 8px}
.gwt-modal-close:hover{color:#333}
.gwt-scenario{margin-bottom:20px;padding:16px;background:#f8f9fa;border-radius:6px;border-left:4px solid #2196F3}
.gwt-scenario:last-child{margin-bottom:0}
.gwt-scenario-title{font-size:14px;font-weight:700;color:#333;margin-bottom:12px}
.gwt-section{margin-bottom:8px}
.gwt-section:last-child{margin-bottom:0}
.gwt-section-title{font-size:12px;font-weight:600;color:#666;text-transform:uppercase;margin-bottom:4px}
.gwt-section-content{font-size:13px;color:#333;line-height:1.4}
.gwt-section-content ul{margin:0;padding-left:20px}
.gwt-section-content li{margin-bottom:4px}
/* Role filter panel */
.role-filter{position:absolute;top:8px;left:8px;background:#fff;border:1px solid #ccc;border-radius:6px;padding:10px 14px;font-size:12px;z-index:100;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.role-filter-title{font-weight:700;margin-bottom:6px;color:#333}
.role-filter-label{display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer;user-select:none}
.role-filter-label input{margin:0;cursor:pointer}
.role-filter-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:2px;vertical-align:middle}
</style>
</head>
<body>
<div class="role-filter" id="role-filter">
  <div class="role-filter-title">Roles</div>
  <div id="role-filter-checkboxes"></div>
</div>
<div class="wrap">
${tableHtml}
<svg width="${geo.width}" height="${geo.height}" viewBox="0 0 ${geo.width} ${geo.height}">
<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#333333"/></marker>
<marker id="arrow-purple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#5E35B1"/></marker>
<marker id="arrow-teal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#00796B"/></marker>
</defs>
${arrowsHtml}
</svg>
</div>

<!-- GWT Modal -->
<div class="gwt-modal" id="gwt-modal">
  <div class="gwt-modal-content">
    <div class="gwt-modal-header">
      <div class="gwt-modal-title" id="gwt-modal-title">GWT Scenarios</div>
      <button class="gwt-modal-close" id="gwt-modal-close">&times;</button>
    </div>
    <div class="gwt-modal-body" id="gwt-modal-body"></div>
  </div>
</div>

<script>
var GWT_DATA = ${gwtDataJson};
var EM_MODEL = ${modelJson};
${layoutScript}
// EM_RENDER(visibleIdsOrNull) — re-render table + SVG for the visible card
// set (null = everything). Called by interactivity.js on every filter change.
function EM_RENDER(visibleIds) {
  var out = EMLayout.wrapInnerHtml(EM_MODEL, visibleIds || null);
  var wrap = document.querySelector('.wrap');
  wrap.innerHTML = out.html;
  wrap.style.width = out.geo.width + 'px';
}
${script}
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// 7. Main
// ---------------------------------------------------------------------------

function main() {
  const inputDir = path.resolve(process.argv[2] || '.');
  const outputFile = path.resolve(process.argv[3] || path.join(inputDir, 'eventmodel.html'));

  const model = buildModel(inputDir);
  const geo = computeGeometry(model);
  const tableHtml = renderTable(model, geo);
  const arrowsHtml = renderArrows(model, geo);
  const html = renderPage(model, geo, tableHtml, arrowsHtml);

  fs.writeFileSync(outputFile, html);

  console.log(`Written ${outputFile}`);
  console.log(
    'Columns:',
    model.columns.map((c) => (
      c.type === 'event' ? c.eventId
      : c.type === 'ext' ? `[ext:${c.extId}]`
      : `[view:${c.viewId}]`
    )).join(' | ')
  );
  console.log(`T=${geo.T} R=${geo.R} P=${geo.P} width=${geo.width} height=${geo.height}`);
  if (model.hasBots) {
    console.log(`Translators (Bots): ${model.translators.map((t) => t.id).join(', ')}`);
  }
  if (model.externalSystems.length) {
    console.log(`External systems: ${model.externalSystems.join(', ')}`);
  }
  if (model.standaloneUis.length) {
    console.log(`Standalone UI(s) (no Triggers:, no view wiring): ${model.standaloneUis.map((u) => u.id).join(', ')}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

module.exports = {
  buildModel, computeGeometry, renderTable, renderArrows, renderPage,
  parseMd, parseMdText, isBracketedField, isDoubleQuestionField, normalizeField, hasMatchingField,
  isTransformationOfSpecialAttribute,
  parseGwtContent, discoverGwtFiles,
};
