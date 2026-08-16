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

// ---------------------------------------------------------------------------
// 1. Parse markdown inputs
// ---------------------------------------------------------------------------

function parseMd(file) {
  const text = fs.readFileSync(file, 'utf8');
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
    const kv = line.match(/^\s*(?:-\s*)?([A-Za-z]+):\s*(.+)/);
    if (kv) {
      const key = kv[1].toLowerCase();
      const val = kv[2].trim();
      switch (key) {
        case 'name': cur.name = val; break;
        case 'actor': cur.actor = val; break;
        case 'type': cur.uiType = val; break;
        case 'produces': cur.produces = val; break;
        case 'observes': cur.observes = val; break;
        case 'triggers':
          // Comma-separated list of command ids this single UI card triggers.
          // Rendering fans this out into one visual UI box per command (see
          // buildModel/renderTable/renderArrows) while the markdown stays a
          // single "## heading" entry.
          cur.triggers = val.split(',').map((s) => s.trim()).filter(Boolean);
          break;
        case 'subprocess': cur.subprocess = val; break;
        case 'id': cur.aggregateId = val; break;
        case 'subscribes':
          cur.subscribes = val.split(',').map((s) => s.trim()).filter(Boolean);
          break;
        case 'consistsof':
          cur.consistsOf = val.split(',').map((s) => s.trim()).filter(Boolean);
          break;
        default: break; // unknown "key: value" — ignore
      }
      continue;
    }
    // A bare bullet ("* field" / "- field", no colon) is a field/parameter
    // shown on the card, e.g. the payload of a read model or event.
    const field = line.match(/^\s*[*-]\s+(.+)/);
    if (field) {
      (cur.fields || (cur.fields = [])).push(field[1].trim());
    }
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

// Normalize a field for comparison: trim, strip an enclosing [...] wrapper
// (so "[policy number]" and "policy number" are considered the same field),
// lowercase. Simple case-insensitive exact-string match — no fuzzy matching.
function normalizeField(f) {
  let t = String(f).trim();
  if (isBracketedField(t)) t = t.slice(1, -1).trim();
  return t.toLowerCase();
}

function hasMatchingField(field, upstreamFieldsList) {
  const target = normalizeField(field);
  return upstreamFieldsList.some((fields) => (fields || []).some((f) => normalizeField(f) === target));
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

// Non-blocking: warn (don't throw) about commands' effective actors (from
// uis.md) that aren't documented in docs/business-definitions.html.
// Ubiquitous-language drift here is a business-intent question, not
// something the generator should silently accept or silently block on —
// surface it and require a human to confirm before it's treated as final.
function checkActorsAgainstDefinitions(commands, inputDir) {
  const terms = loadDefinedTerms(inputDir);
  if (!terms) return;
  const actors = new Set();
  commands.forEach((c) => { if (c.actor) actors.add(c.actor); });
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

  // uis.md links to a command or a read model(s) by sharing its id, or via
  // an explicit `ConsistsOf:` list:
  //  - a UI whose id matches a command  -> the human trigger for that command
  //    (input UI, rendered above the command, in the role row of `Actor:`).
  //  - a UI whose id matches a read model, and/or lists read model ids in
  //    `ConsistsOf:` -> the rendered output of that view (or views), e.g. a
  //    pdf/html screen composed from several projections. Rendered in the
  //    row of `Actor:` — the person who receives/reads it — placed in the
  //    rightmost source read model's column, with one arrow per source.
  // `Type:` (html, pdf, ...) is a display hint only; linkage is by id.
  const uiById = {};
  uis.forEach((u) => { uiById[u.id] = u; });
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
  // actor — a command's role-row placement is keyed by a single actor, so
  // conflicting actors across triggering UIs would be ambiguous and must
  // be surfaced rather than guessed at (e.g. silently picking the first).
  Object.keys(triggerUiForCommand).forEach((cmdId) => {
    const list = triggerUiForCommand[cmdId];
    const actors = new Set(list.map((u) => u.actor));
    if (actors.size > 1) {
      throw new Error(
        `Command "${cmdId}" is triggered by UIs with different actors — ${list.map((u) => `${u.id}:${u.actor}`).join(', ')}. ` +
        `All UIs triggering the same command must share the same Actor:.`
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

  const orphanUis = uis.filter((u) => !(u.triggers && u.triggers.length) && !commandIds.has(u.id) && !uiSources[u.id]);
  if (orphanUis.length) {
    throw new Error(
      `UI(s) in uis.md with no matching command or read model id — ${orphanUis.map((u) => u.id).join(', ')}. ` +
      `Each "## heading" in uis.md must match a command id (input UI), declare "Triggers: <command-id>" ` +
      `(input UI with its own id), or match/list read model id(s) via its own id or ConsistsOf: (output UI).`
    );
  }

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
  commands.forEach((c) => { c.actor = triggerUiForCommand[c.id] ? triggerUiForCommand[c.id][0].actor : undefined; });

  commands.forEach((c) => { if (!c.name) c.name = c.id; c._h = cardHeight(c.aggregateId ? CMD_H + AGG_ID_H : CMD_H, c.fields); });
  const defaultSubprocess = (events[0] && events[0].subprocess) || 'Default';
  events.forEach((e) => {
    if (!e.name) e.name = e.id;
    if (!e.subprocess) e.subprocess = defaultSubprocess;
    e._h = cardHeight(EVT_H, e.fields);
  });
  readmodels.forEach((r) => { if (!r.name) r.name = r.id; r._h = cardHeight(r.aggregateId ? VIEW_H + AGG_ID_H : VIEW_H, r.fields); });

  const eventProducer = {}; // eventId -> command
  commands.forEach((c) => { if (c.produces) eventProducer[c.produces] = c; });

  // Sanity: every event must have a producing command (canonical rule).
  const orphanEvents = events.filter((e) => !eventProducer[e.id]);
  if (orphanEvents.length) {
    throw new Error(
      `Orphan event(s) with no Produces: link — ${orphanEvents.map((e) => e.id).join(', ')}`
    );
  }

  // Sanity: every event must declare its owning aggregate via id:{Type}
  // (see SKILL.md "Diagram consistency" — mandatory id attribute). This is
  // a hard blocker, same tier as the orphan-event check.
  const eventsMissingId = events.filter((e) => !e.aggregateId);
  if (eventsMissingId.length) {
    throw new Error(
      `Event(s) missing mandatory "id:{Aggregate}" — ${eventsMissingId.map((e) => e.id).join(', ')}. ` +
      `Add e.g. "id:Policy" to declare which aggregate the event belongs to.`
    );
  }

  // Ubiquitous-language check (non-blocking warning, not a hard failure —
  // whether to formally document a term is a business-intent decision).
  checkActorsAgainstDefinitions(commands, inputDir);

  // Sanity: every non-bracketed event field must trace back to the same
  // field on its producing command (canonical rule, see SKILL.md — "Diagram
  // consistency"). Bracketed fields ([...]) are exempt (calculated/system-
  // generated, intentionally not a direct passthrough).
  events.forEach((e) => {
    const cmd = eventProducer[e.id];
    if (!cmd) return; // already reported as an orphan event above
    (e.fields || []).forEach((f) => {
      if (isBracketedField(f)) return;
      if (!hasMatchingField(f, [cmd.fields])) {
        throw new Error(
          `Consistency error: event '${e.id}' field "${f.trim()}" has no matching field in producing command '${cmd.id}'. ` +
          `If this field is system-generated or calculated (not a direct passthrough), wrap it in [...], e.g. "[${f.trim()}]". ` +
          `Otherwise add the field to the command's payload.`
        );
      }
    });
  });

  // Sanity: every non-bracketed read-model field must trace back to the same
  // field on at least one of its subscribed events.
  readmodels.forEach((rm) => {
    const subEvents = (rm.subscribes || []).map((id) => events.find((e) => e.id === id)).filter(Boolean);
    (rm.fields || []).forEach((f) => {
      if (isBracketedField(f)) return;
      if (!hasMatchingField(f, subEvents.map((e) => e.fields))) {
        throw new Error(
          `Consistency error: read model '${rm.id}' field "${f.trim()}" has no matching field in any subscribed event. ` +
          `If this field is system-generated or calculated (not a direct passthrough), wrap it in [...], e.g. "[${f.trim()}]". ` +
          `Otherwise add the field to the source event's payload.`
        );
      }
    });
  });

  // columns: one per event initially, in chronological (file) order.
  let columns = events.map((e) => ({ type: 'event', eventId: e.id }));
  // midRow[i]: null | {type:'cmd', id} | {type:'view', id} — mirrors columns.
  let midRow = columns.map((c) => {
    const cmd = eventProducer[c.eventId];
    return cmd ? { type: 'cmd', id: cmd.id } : null;
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

    if (naturalIdx >= columns.length) {
      columns.push({ type: 'view', viewId: null });
      midRow.push(null);
      naturalIdx = columns.length - 1;
    } else if (midRow[naturalIdx] != null) {
      columns.splice(naturalIdx, 0, { type: 'view', viewId: null });
      midRow.splice(naturalIdx, 0, null);
    }
    columns[naturalIdx] = { type: 'view', viewId: rm.id };
    midRow[naturalIdx] = { type: 'view', id: rm.id };
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

  const roles = [];
  commands.forEach((c) => {
    if (c.actor && !roles.includes(c.actor)) roles.push(c.actor);
  });
  uis.forEach((ui) => {
    if (uiSources[ui.id] && ui.actor && !roles.includes(ui.actor)) roles.push(ui.actor);
  });
  // A command is automated ("System") when it declares `Observes:` — that's
  // the sole signal now that commands no longer carry an `Actor:` label.
  const hasSystem = commands.some((c) => !!c.observes);

  const subprocesses = [];
  events.forEach((e) => { if (!subprocesses.includes(e.subprocess)) subprocesses.push(e.subprocess); });

  return {
    commands, events, readmodels, uis, uiById, triggerUiForCommand, uiSources, uiPlacementCol,
    eventProducer, columns, midRow, colIndexForEvent, colIndexForView, roles, hasSystem, subprocesses,
    standaloneUis,
  };
}

// ---------------------------------------------------------------------------
// 3. Geometry
// ---------------------------------------------------------------------------

const GUT = 180, COL = 360;
const TIME_H = 40, ROLE_H = 130, SYS_H = 130, MID_H = 120, PROC_H = 150;
const UI_W = 210, UI_H = 76;
const STANDALONE_H = 130; // dedicated row for UI cards with no Triggers: and no read-model view wiring
const CMD_W = 200, CMD_H = 56;
const AGG_ID_H = 14; // extra height to fit an optional/mandatory "id:{Aggregate}" line
const EVT_W = 220, EVT_H = 60 + AGG_ID_H; // events always carry the mandatory aggregate-id line
const VIEW_W = 220, VIEW_H = 60;
const RADIUS = 8; // card border-radius; inset corner-ish endpoints by this along the straight edge they touch

// Fields (parameters) block: cards grow to fit their bullet list, capped so
// one very long list doesn't blow up the whole row — beyond MAX_FIELDS the
// block gets a fixed height and scrolls internally instead.
const FIELD_LINE_H = 14, FIELD_PAD = 10, MAX_FIELDS = 6;
const ROW_MARGIN = 40; // vertical breathing room a row keeps around its tallest card

function fieldsBlockHeight(fields) {
  if (!fields || !fields.length) return 0;
  return FIELD_PAD + Math.min(fields.length, MAX_FIELDS) * FIELD_LINE_H;
}
function cardHeight(baseH, fields) {
  return baseH + fieldsBlockHeight(fields);
}
function rowHeightFor(maxCardH, minRowH) {
  return Math.max(minRowH, maxCardH + ROW_MARGIN);
}

function computeGeometry(model) {
  const { commands, events, readmodels, subprocesses } = model;
  const T = model.columns.length;
  const R = model.roles.length;
  const P = model.subprocesses.length;
  const width = GUT + T * COL;

  const midCardHeights = [...commands.map((c) => c._h), ...readmodels.map((r) => r._h)];
  const midRowH = rowHeightFor(Math.max(0, ...midCardHeights), MID_H);

  const procHeights = subprocesses.map((sp) => {
    const evHeights = events.filter((e) => e.subprocess === sp).map((e) => e._h);
    return rowHeightFor(Math.max(0, ...evHeights), PROC_H);
  });

  const standaloneH = model.standaloneUis.length ? STANDALONE_H : 0;
  const midRowTop = TIME_H + standaloneH + R * ROLE_H + (model.hasSystem ? SYS_H : 0);
  const processTop = midRowTop + midRowH;
  const procGroupTop = (g) => processTop + procHeights.slice(0, g).reduce((a, b) => a + b, 0);
  const height = processTop + procHeights.reduce((a, b) => a + b, 0);
  return {
    T, R, P, width, height, midRowTop, processTop, midRowH, procHeights, standaloneH,
    colCenterX: (i) => COL * (i + 1),
    roleCenterY: (r) => TIME_H + standaloneH + r * ROLE_H + ROLE_H / 2,
    sysCenterY: () => TIME_H + standaloneH + R * ROLE_H + SYS_H / 2,
    midCenterY: () => midRowTop + midRowH / 2,
    procGroupTop,
    procCenterY: (g) => procGroupTop(g) + procHeights[g] / 2,
  };
}

const ROLE_TINTS = ['#ffe0ec', '#e2e9f5', '#fde7d0', '#e0f0ff', '#f0e0ff'];
const PROC_TINTS = ['#fdf3d3', '#e4f4dc', '#e0e8f7', '#f7e0ec', '#e8f0e0'];
const roleColor = (r) => ROLE_TINTS[r % ROLE_TINTS.length];
const procColor = (g) => PROC_TINTS[g % PROC_TINTS.length];

// ---------------------------------------------------------------------------
// 4. Render table rows
// ---------------------------------------------------------------------------

function fieldsHtml(fields) {
  if (!fields || !fields.length) return '';
  const capped = fields.length > MAX_FIELDS;
  const style = capped ? ` style="max-height:${MAX_FIELDS * FIELD_LINE_H}px;overflow-y:auto"` : '';
  return `<div class="fields"${style}><ul>${fields.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul></div>`;
}

function renderTable(model, geo) {
  const { commands, events, readmodels, uiById, triggerUiForCommand, uis, uiPlacementCol, eventProducer, columns, midRow, roles, hasSystem, subprocesses, standaloneUis } = model;

  const colgroup = `<col style="width:${GUT}px">` + columns.map(() => `<col style="width:${COL}px">`).join('');

  let timeCells = `<td class="gutter"></td>`;
  let n = 0;
  columns.forEach((c) => {
    if (c.type === 'event') {
      n += 1;
      timeCells += `<td class="time-cell"><div class="time-badge">${n}</div></td>`;
    } else {
      timeCells += `<td class="time-cell"></td>`;
    }
  });
  const timeRow = `<tr style="height:${TIME_H}px">${timeCells}</tr>`;

  // Standalone UIs row: cards defined in uis.md with no `Triggers:` wiring
  // (or whose trigger slot was already claimed by another UI) and no
  // read-model view wiring. Rather than dropping them, they get their own
  // dedicated row right under the time row, laid out left-to-right in a
  // single spanning cell — there's no natural column for them since they
  // don't relate to any specific event/command/view column.
  let standaloneRow = '';
  if (standaloneUis.length) {
    const cards = standaloneUis.map((u) => {
      const label = u.uiType ? u.uiType.toUpperCase() : 'UI';
      return `<div class="card ui-card standalone-ui" data-element="ui-${u.id}" data-type="ui" title="ui-${u.id} — standalone UI (no Triggers:, no view) — click to focus, click again to clear"><div class="ui-label">${escapeHtml(label)}</div><div class="title">${escapeHtml(u.name || u.id)}</div>${u.actor ? `<div class="caption">${escapeHtml(u.actor)}</div>` : ''}</div>`;
    }).join('');
    standaloneRow = `<tr style="height:${STANDALONE_H}px"><td class="gutter standalone-gutter">Unwired UIs</td><td class="lane-cell standalone-cell" colspan="${columns.length}"><div class="standalone-row">${cards}</div></td></tr>`;
  }

  const roleRows = roles.map((role, r) => {
    let cells = `<td class="gutter role-gutter" style="background:${roleColor(r)}">${escapeHtml(role)}</td>`;
    columns.forEach((c, i) => {
      let content = '';
      if (c.type === 'event') {
        const cmd = eventProducer[c.eventId];
        if (cmd && cmd.actor === role) {
          // Fan-in: a command may be triggered by more than one UI (e.g. an
          // explicit Triggers: claim plus an id-match claim, or several
          // distinct entry-point scenarios) — render one box per triggering
          // UI, side by side, in this same cell.
          const triggerUis = triggerUiForCommand[cmd.id] || [{ id: cmd.id, name: cmd.name, uiType: undefined }];
          const cards = triggerUis.map((ui) => {
            const label = ui && ui.uiType ? ui.uiType.toUpperCase() : 'UI';
            const uiId = ui.id;
            return `<div class="card ui-card" data-element="ui-${uiId}" data-type="ui" title="ui-${uiId} — click to focus, click again to clear"><div class="ui-label">${escapeHtml(label)}</div><div class="title">${escapeHtml(ui.name || cmd.name)}</div></div>`;
          }).join('');
          content = triggerUis.length > 1 ? `<div class="ui-fanin-row">${cards}</div>` : cards;
        }
      }
      // Output UI (e.g. a pdf/html screen projected from one or more read
      // models — see ConsistsOf:), placed by column index rather than by
      // matching a single read model's column, so it also works when its
      // own id doesn't equal any read model id (a purely composite UI).
      if (!content) {
        const outUi = uis.find((u) => uiPlacementCol[u.id] === i && u.actor === role);
        if (outUi) {
          const label = outUi.uiType ? outUi.uiType.toUpperCase() : 'UI';
          content = `<div class="card ui-card" data-element="ui-${outUi.id}" data-type="ui" title="ui-${outUi.id} — click to focus, click again to clear"><div class="ui-label">${escapeHtml(label)}</div><div class="title">${escapeHtml(outUi.name || outUi.id)}</div></div>`;
        }
      }
      cells += `<td class="lane-cell" style="background:${roleColor(r)}">${content}</td>`;
    });
    return `<tr style="height:${ROLE_H}px">${cells}</tr>`;
  }).join('\n');

  let systemRow = '';
  if (hasSystem) {
    let cells = `<td class="gutter sys-gutter">System</td>`;
    columns.forEach(() => { cells += `<td class="lane-cell sys-cell"></td>`; });
    systemRow = `<tr style="height:${SYS_H}px">${cells}</tr>`;
  }

  let midCells = `<td class="gutter mid-gutter"></td>`;
  columns.forEach((c, i) => {
    const occ = midRow[i];
    let content = '';
    if (occ && occ.type === 'cmd') {
      const cmd = commands.find((cc) => cc.id === occ.id);
      const isSystem = !!cmd.observes;
      content = `<div class="card cmd-card${isSystem ? ' system-cmd' : ''}" style="height:${cmd._h}px" data-element="${cmd.id}" data-type="cmd" title="${cmd.id} — click to focus, click again to clear">${isSystem ? '<div class="sys-badge">⚙ SYSTEM</div>' : ''}<div class="title">${escapeHtml(cmd.name)}</div>${cmd.aggregateId ? `<div class="agg-id">id:${escapeHtml(cmd.aggregateId)}</div>` : ''}${fieldsHtml(cmd.fields)}</div>`;
    } else if (occ && occ.type === 'view') {
      const rm = readmodels.find((rr) => rr.id === occ.id);
      content = `<div class="card view-card" style="height:${rm._h}px" data-element="${rm.id}" data-type="view" title="${rm.id} — click to focus, click again to clear"><div class="title">${escapeHtml(rm.name)}</div>${rm.aggregateId ? `<div class="agg-id">id:${escapeHtml(rm.aggregateId)}</div>` : ''}${fieldsHtml(rm.fields)}</div>`;
    }
    midCells += `<td class="lane-cell mid-cell">${content}</td>`;
  });
  const midRowHtml = `<tr class="mid-row" style="height:${geo.midRowH}px">${midCells}</tr>`;

  const processRows = subprocesses.map((sp, g) => {
    let cells = `<td class="gutter proc-gutter" style="background:${procColor(g)}">${escapeHtml(sp)} process</td>`;
    columns.forEach((c) => {
      let content = '';
      if (c.type === 'event') {
        const ev = events.find((e) => e.id === c.eventId);
        if (ev.subprocess === sp) {
          content = `<div class="card evt-card" style="height:${ev._h}px" data-element="${ev.id}" data-type="evt" title="${ev.id} — click to focus, click again to clear"><div class="title">${escapeHtml(ev.name)}</div><div class="agg-id">id:${escapeHtml(ev.aggregateId)}</div>${fieldsHtml(ev.fields)}</div>`;
        }
      }
      cells += `<td class="lane-cell" style="background:${procColor(g)}">${content}</td>`;
    });
    return `<tr style="height:${geo.procHeights[g]}px">${cells}</tr>`;
  }).join('\n');

  return `<table>\n<colgroup>${colgroup}</colgroup>\n${timeRow}\n${standaloneRow}\n${roleRows}\n${systemRow}\n${midRowHtml}\n${processRows}\n</table>`;
}

// ---------------------------------------------------------------------------
// 5. Arrows
// ---------------------------------------------------------------------------

function renderArrows(model, geo) {
  const { commands, events, readmodels, uiById, triggerUiForCommand, uis, uiSources, uiPlacementCol, eventProducer, columns, roles, subprocesses, colIndexForEvent, colIndexForView } = model;
  const arrows = [];
  const roleIndex = (actor) => roles.indexOf(actor);

  columns.forEach((c, i) => {
    if (c.type !== 'event') return;
    const ev = events.find((e) => e.id === c.eventId);
    const cmd = eventProducer[ev.id];
    const cx = geo.colCenterX(i);
    const evGroup = subprocesses.indexOf(ev.subprocess);
    const evTop = geo.procCenterY(evGroup) - ev._h / 2;
    const midTop = geo.midCenterY() - cmd._h / 2;
    const midBottom = geo.midCenterY() + cmd._h / 2;

    if (!cmd.observes) {
      const r = roleIndex(cmd.actor);
      const roleBottom = geo.roleCenterY(r) + UI_H / 2;
      // Fan-in: draw one arrow per triggering UI, each anchored under its
      // own box's x position within the fanned-in row (mirrors the CSS
      // layout in renderTable's .ui-fanin-row: boxes centered on cx, laid
      // out left-to-right with a fixed gap).
      const triggerUis = triggerUiForCommand[cmd.id] || [{ id: cmd.id }];
      const K = triggerUis.length;
      const GAP = 8;
      const totalW = K * UI_W + (K - 1) * GAP;
      triggerUis.forEach((ui, k) => {
        const boxCx = K > 1 ? (cx - totalW / 2 + UI_W / 2 + k * (UI_W + GAP)) : cx;
        arrows.push({ x1: boxCx, y1: roleBottom, x2: cx, y2: midTop, from: `ui-${ui.id}`, to: cmd.id, marker: 'arrow' });
      });
    } else {
      const obsIdx = colIndexForEvent(cmd.observes);
      const obsEv = events.find((e) => e.id === cmd.observes);
      const obsGroup = subprocesses.indexOf(obsEv.subprocess);
      const obsCx = geo.colCenterX(obsIdx);
      const obsTopRightX = obsCx + EVT_W / 2 - RADIUS; // inset off the rounded corner
      const obsTop = geo.procCenterY(obsGroup) - obsEv._h / 2;
      const sysY = geo.sysCenterY();
      arrows.push({
        polyline: [[obsTopRightX, obsTop], [obsTopRightX, sysY], [cx, sysY], [cx, midTop]],
        from: cmd.observes, to: cmd.id, dashed: true, marker: 'arrow-purple',
      });
    }
    arrows.push({ x1: cx, y1: midBottom, x2: cx, y2: evTop, from: cmd.id, to: ev.id, marker: 'arrow' });
  });

  readmodels.forEach((rm) => {
    const rmIdx = columns.findIndex((c) => c.type === 'view' && c.viewId === rm.id);
    const rmCx = geo.colCenterX(rmIdx);
    const rmCy = geo.midCenterY();

    const entries = { left: [], right: [], bottom: [] };
    (rm.subscribes || []).forEach((evId) => {
      const idx = colIndexForEvent(evId);
      if (idx === rmIdx) entries.bottom.push(evId);
      else if (idx < rmIdx) entries.left.push(evId);
      else entries.right.push(evId);
    });
    ['left', 'right', 'bottom'].forEach((side) => {
      const list = entries[side];
      const K = list.length;
      list.forEach((evId, k) => {
        const idx = colIndexForEvent(evId);
        const ev = events.find((e) => e.id === evId);
        const evGroup = subprocesses.indexOf(ev.subprocess);
        const evCx = geo.colCenterX(idx);
        const evTop = geo.procCenterY(evGroup) - ev._h / 2;
        let exitX;
        if (idx < rmIdx) exitX = evCx + EVT_W / 2 - RADIUS; // top-right corner, inset
        else if (idx > rmIdx) exitX = evCx - EVT_W / 2 + RADIUS; // top-left corner, inset
        else exitX = evCx;
        const bandY = Math.min(geo.midCenterY() + geo.midRowH / 2 + 20, evTop - 15);
        const spread = K > 1 ? (-30 + (20 * (k + 1)) / (K + 1)) : 0;
        let entryX, entryY;
        if (side === 'left') { entryX = rmCx - VIEW_W / 2; entryY = rmCy + spread; }
        else if (side === 'right') { entryX = rmCx + VIEW_W / 2; entryY = rmCy + spread; }
        else { entryX = rmCx + spread; entryY = rmCy + rm._h / 2; }
        arrows.push({
          polyline: [[exitX, evTop], [exitX, bandY], [entryX, bandY], [entryX, entryY]],
          from: ev.id, to: rm.id, purpleNoMarker: true,
        });
      });
    });
  });

  // Read model(s) -> output UI (e.g. a pdf document, or one composed from
  // several views via ConsistsOf:). Mirrors the UI -> command arrow, but
  // reversed: flows from each source view up into the role row of the actor
  // who reads it. The UI card sits in its rightmost source's column
  // (`uiPlacementCol`); a source in that same column gets a straight
  // vertical arrow, any other source is routed sideways into it first.
  uis.forEach((ui) => {
    const srcs = uiSources[ui.id];
    if (!srcs || !ui.actor) return;
    const r = roles.indexOf(ui.actor);
    if (r === -1) return;
    const placementIdx = uiPlacementCol[ui.id];
    const uiCx = geo.colCenterX(placementIdx);
    const roleBottom = geo.roleCenterY(r) + UI_H / 2;
    srcs.forEach((rmId) => {
      const rm = readmodels.find((rr) => rr.id === rmId);
      const idx = colIndexForView(rmId);
      const rmCx = geo.colCenterX(idx);
      const rmTop = geo.midCenterY() - rm._h / 2;
      if (idx === placementIdx) {
        arrows.push({ x1: rmCx, y1: rmTop, x2: uiCx, y2: roleBottom, from: rm.id, to: `ui-${ui.id}`, marker: 'arrow' });
      } else {
        const exitX = idx < placementIdx ? rmCx + VIEW_W / 2 - RADIUS : rmCx - VIEW_W / 2 + RADIUS;
        const bandY = roleBottom + 15; // card-free band just below the role row
        arrows.push({
          polyline: [[exitX, rmTop], [exitX, bandY], [uiCx, bandY], [uiCx, roleBottom]],
          from: rm.id, to: `ui-${ui.id}`, marker: 'arrow',
        });
      }
    });
  });

  return arrows.map((a) => {
    const dashAttr = a.dashed ? ' stroke-dasharray="6,4"' : '';
    const color = a.dashed || a.purpleNoMarker ? '#5E35B1' : '#333333';
    const markerAttr = a.marker ? ` marker-end="url(#${a.marker})"` : '';
    if (a.polyline) {
      const pts = a.polyline.map((p) => p.join(',')).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"${dashAttr}${markerAttr} data-from="${a.from}" data-to="${a.to}"/>`;
    }
    return `<line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="${color}" stroke-width="2"${markerAttr} data-from="${a.from}" data-to="${a.to}"/>`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// 6. Page assembly
// ---------------------------------------------------------------------------

function renderPage(model, geo, tableHtml, arrowsHtml) {
  const script = fs.readFileSync(INTERACTIVITY_JS, 'utf8');
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
}
*{box-sizing:border-box}
body{margin:0;padding:40px;background:#fafafa;font-family:'OpenSans','Noto Sans',Arial,sans-serif;color:var(--ink)}
.wrap{position:relative;width:${geo.width}px;margin:0 auto}
table{table-layout:fixed;border-collapse:collapse;width:${geo.width}px}
td{padding:0;vertical-align:middle;text-align:center;border:none}
.gutter{font-size:12px;font-weight:600;color:#555;padding:0 10px;text-align:left;vertical-align:middle}
.time-cell{vertical-align:middle}
.time-badge{width:26px;height:26px;border-radius:50%;background:#fff;border:2px solid #333;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin:0 auto}
.sys-gutter{background:#e2e9f5}
.mid-gutter{background:#f7f8f9}
.mid-cell{background:#f7f8f9}tr.mid-row td.mid-cell{border-top:2px dashed #bbb;border-bottom:2px dashed #bbb}
.standalone-gutter{background:#f2f2f2;font-style:italic}
.standalone-cell{background:#fbfbfb;border-bottom:2px dotted #ccc;text-align:left;vertical-align:middle}
.standalone-row{display:flex;flex-wrap:wrap;gap:16px;padding:12px 20px}
.standalone-ui{border-style:dashed}
.ui-fanin-row{display:inline-flex;gap:8px;align-items:center;justify-content:center}
.card{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.15);position:relative;user-select:none;transition:opacity .15s}
.card.dim{opacity:.12}
.card.active{outline:3px solid #333;outline-offset:2px}
svg [data-from].dim{opacity:.08}
.ui-card{width:${UI_W}px;height:${UI_H}px;background:#fff;border:2px solid #ccc}
.ui-label{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.05em}
.cmd-card{width:${CMD_W}px;background:var(--command);color:#eafffb}
.evt-card{width:${EVT_W}px;background:var(--event);color:#8a6408}
.view-card{width:${VIEW_W}px;background:var(--view);color:#35681f}
.title{font-size:13px;font-weight:700;padding:0 8px;text-align:center;flex-shrink:0}
.caption{font-size:10px;opacity:.8;text-transform:uppercase;letter-spacing:.04em}
.agg-id{font-size:10px;font-weight:700;text-align:center;flex-shrink:0}
.fields{width:100%;margin-top:4px;padding:5px 10px 5px;border-top:1px solid rgba(0,0,0,.15)}
.fields ul{list-style:none;margin:0;padding:0}
.fields li{font-size:10px;line-height:14px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fields li::before{content:'•';margin-right:5px;opacity:.6}
.sys-badge{position:absolute;top:-10px;font-size:9px;background:#5E35B1;color:#fff;padding:2px 6px;border-radius:10px}
svg{position:absolute;top:0;left:0;pointer-events:none}
</style>
</head>
<body>
<div class="wrap">
${tableHtml}
<svg width="${geo.width}" height="${geo.height}" viewBox="0 0 ${geo.width} ${geo.height}">
<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#333333"/></marker>
<marker id="arrow-purple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#5E35B1"/></marker>
</defs>
${arrowsHtml}
</svg>
</div>
<script>
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
    model.columns.map((c) => (c.type === 'event' ? c.eventId : `[view:${c.viewId}]`)).join(' | ')
  );
  console.log(`T=${geo.T} R=${geo.R} P=${geo.P} width=${geo.width} height=${geo.height}`);
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

module.exports = { buildModel, computeGeometry, renderTable, renderArrows, renderPage };
