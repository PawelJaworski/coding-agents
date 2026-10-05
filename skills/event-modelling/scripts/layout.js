'use strict';
/*
 * Shared layout/render core for Event Modeling diagrams.
 *
 * Dual-environment module — required by scripts/generate.js in Node AND
 * inlined verbatim into the generated page (window.EMLayout) so the browser
 * re-runs the exact same layout math when the focus filter adds/removes
 * cards (see docs/plan-responsive-filtering.md). Pure functions only:
 * no fs/path/require, no Node or DOM APIs.
 *
 * The model passed in is the plain-data object built by buildModel() —
 * JSON-serialisable (no function-valued properties).
 */

// ---------------------------------------------------------------------------
// Geometry constants
// ---------------------------------------------------------------------------

const GUT = 180, COL = 360;
const TIME_H = 40, ROLE_H = 130, SYS_H = 130, MID_H = 120, PROC_H = 150;
const BOTS_H = 130; // top "Bots" swimlane holding all translator cards
const EXT_SYS_H = 150; // bottom swimlanes, one per external System name:
const UI_W = 210, UI_H = 76;
const STANDALONE_H = 130; // dedicated row for UI cards with no Triggers: and no read-model view wiring
const CMD_W = 200, CMD_H = 56;
const AGG_ID_H = 14; // extra height to fit an optional/mandatory "{aggregateName}:Id" line
const EVT_W = 220, EVT_H = 60 + AGG_ID_H; // events always carry the mandatory aggregate-id line
const EXT_EVT_W = 220, EXT_EVT_BASE_H = 60; // external events: NO mandatory :Id line (external contract)
const TR_W = 200, TR_H = 56; // translator card (sprocket icon, Bots row)
const TR_TYPE_H = 12; // extra height to fit an optional free-form `Type:` label line
const VIEW_W = 220, VIEW_H = 60;
const RADIUS = 8; // card border-radius; inset corner-ish endpoints by this along the straight edge they touch
const TRANS_LINE = '#00796B'; // teal — translation arrows (external event -> translator -> command)

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

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function isDoubleQuestionField(f) {
  return String(f).trim().endsWith('??');
}

// Strip a trailing "??" for display purposes (the marker itself is never
// shown on the card — only [...] renders literally).
function stripDoubleQuestion(f) {
  const t = String(f).trim();
  return isDoubleQuestionField(t) ? t.slice(0, -2).trim() : t;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fieldsHtml(fields) {
  if (!fields || !fields.length) return '';
  const capped = fields.length > MAX_FIELDS;
  const style = capped ? ` style="max-height:${MAX_FIELDS * FIELD_LINE_H}px;overflow-y:auto"` : '';
  return `<div class="fields"${style}><ul>${fields.map((f) => `<li>${escapeHtml(stripDoubleQuestion(f))}</li>`).join('')}</ul></div>`;
}

// Read-model-only: stacked bold lines directly under the title — the
// aggregate-id line first (if present), then each key line in the order
// written in the markdown. Each key line renders with its own suffix
// (`:Key` / `:RowKey`) exactly as written in readmodels.md.
// Reuses the `.agg-id` CSS class per line (one <div> per line, not joined),
// mirroring how the aggregate-id line alone renders on commands/events.
function idKeyLinesHtml(rm) {
  const lines = [];
  if (rm.aggregateId) lines.push(`${escapeHtml(rm.aggregateId)}:Id`);
  (rm.keys || []).forEach((k) => lines.push(`${escapeHtml(k.name)}:${k.mode}`));
  return lines.map((l) => `<div class="agg-id">${l}</div>`).join('');
}

// Actor names, one per line with a small gap (`.actor-lines`); a single name
// stays plain text so one-actor models render exactly as before.
function actorsHtml(actors) {
  const names = (actors || []).map((a) => escapeHtml(a));
  if (names.length <= 1) return names.join('');
  return `<div class="actor-lines">${names.map((n) => `<div>${n}</div>`).join('')}</div>`;
}

function triggerUiElementId(uiId, commandId) {
  return `ui-${uiId}--triggers-${commandId}`;
}

function outputUiElementId(uiId) {
  return `ui-${uiId}--displays`;
}

// ---------------------------------------------------------------------------
// Column index helpers (pure — model.columns lookup)
// ---------------------------------------------------------------------------

function colIndexForEvent(model, eventId) {
  return model.columns.findIndex((c) => c.type === 'event' && c.eventId === eventId);
}
function colIndexForView(model, viewId) {
  return model.columns.findIndex((c) => c.type === 'view' && c.viewId === viewId);
}
function colIndexForExt(model, extId) {
  return model.columns.findIndex((c) => c.type === 'ext' && c.extId === extId);
}
function translatorElementId(trId, cmdId) {
  return `tr-${trId}--cmd-${cmdId}`;
}

// ---------------------------------------------------------------------------
// Card registry — the "map of cards and their sizes"
// ---------------------------------------------------------------------------
//
// placeCards(model) returns one entry per VISUAL card, with the exact
// placement renderTable uses (row lane, column) and its box size. This is
// the single source of truth for "which cards exist where how big" —
// computeGeometry derives row heights / column activity from it, renderTable
// draws from it, and the browser filter adds/removes entries to re-flow the
// diagram (no gaps). Row: {kind:'bots'|'standalone'|'role'|'mid'|'proc'|'ext',
// index}; col is the model.columns index (null = spanning "Unwired UIs" row).
//
// Placement mirrors renderTable cell-for-cell, including its quirks: a
// trigger-UI cell never also hosts an output UI (`if (!content)`), and when
// several output UIs claim the same (role, column) cell the FIRST in uis.md
// order wins (uis.find) — the rest is not rendered.

function placeCards(model) {
  const {
    commands, events, readmodels, uis, triggerUiForCommand, uiPlacementCol,
    eventProducer, commandPrimaryEvent, columns, midRow, roles, subprocesses,
    standaloneUis, externalEvents, externalSystems, translatorBoxes,
  } = model;
  const cards = [];
  const push = (id, kind, row, col, w, h) => cards.push({ id, kind, row, col, w, h });

  // Bots row: one card per (translator, produced command) pair.
  translatorBoxes.forEach((b) => push(b.elementId, 'tr', { kind: 'bots', index: 0 }, b.colIdx, TR_W, b.tr._h));

  // "Unwired UIs" spanning row (no column).
  standaloneUis.forEach((u) => push(`ui-${u.id}`, 'standalone-ui', { kind: 'standalone', index: 0 }, null, UI_W, UI_H));

  // Role rows: trigger UIs (fan-in side by side) then output UIs in free cells.
  const takenUiCells = new Set();
  roles.forEach((role, r) => {
    columns.forEach((c, i) => {
      if (c.type !== 'event') return;
      const cmd = eventProducer[c.eventId];
      if (!cmd || cmd.actorKey !== role.key) return;
      if (commandPrimaryEvent[cmd.id] !== c.eventId) return;
      const triggerUis = triggerUiForCommand[cmd.id] || [{ id: cmd.id, name: cmd.name, typeHint: undefined }];
      triggerUis.forEach((ui) => {
        push(triggerUiElementId(ui.id, cmd.id), 'ui', { kind: 'role', index: r }, i, UI_W, UI_H);
        takenUiCells.add(`${r}|${i}`);
      });
    });
    uis.forEach((u) => {
      const i = uiPlacementCol[u.id];
      if (i === undefined || i < 0 || u.actorKey !== role.key) return;
      if (takenUiCells.has(`${r}|${i}`)) return; // trigger UI owns this cell
      takenUiCells.add(`${r}|${i}`);
      push(outputUiElementId(u.id), 'ui', { kind: 'role', index: r }, i, UI_W, UI_H);
    });
  });

  // Mid row: commands (at their primary event's column) and read models.
  midRow.forEach((occ, i) => {
    if (!occ) return;
    if (occ.type === 'cmd') {
      const cmd = commands.find((cc) => cc.id === occ.id);
      if (cmd) push(cmd.id, 'cmd', { kind: 'mid', index: 0 }, i, CMD_W, cmd._h);
    } else {
      const rm = readmodels.find((rr) => rr.id === occ.id);
      if (rm) push(rm.id, 'view', { kind: 'mid', index: 0 }, i, VIEW_W, rm._h);
    }
  });

  // Process rows: one event card per (subprocess, event) at its own column.
  events.forEach((ev) => {
    push(ev.id, 'evt', { kind: 'proc', index: subprocesses.indexOf(ev.subprocess) },
      colIndexForEvent(model, ev.id), EVT_W, ev._h);
  });

  // External-system rows: external event cards.
  externalEvents.forEach((ev) => {
    push(`ext-${ev.id}`, 'ext', { kind: 'ext', index: externalSystems.indexOf(ev.systemName) },
      colIndexForExt(model, ev.id), EXT_EVT_W, ev._h);
  });

  return cards;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
//
// computeGeometry(model, visibleIds?) — the responsive layout pass.
//
//   visibleIds: the ids of the cards that survive the current focus filter —
//   either a Set of ids or a plain {id:true} map (the shape connectedSet()
//   builds in reference/interactivity.js) — or null/undefined for everything
//   visible (the static/no-JS page and the cleared filter).
//
// Rows and columns holding no visible card collapse to zero height/width, so
// a filtered diagram re-flows with NO gaps where hidden cards were. Row
// heights re-fit to the tallest *visible* card ("map of cards and their
// sizes" — the registry above).
//
// Unfiltered, every formula reduces to the original fixed-layout math.

function computeGeometry(model, visibleIds) {
  const {
    columns, roles, subprocesses, externalSystems, hasBots, hasSystem,
  } = model;
  const unfiltered = !visibleIds;
  // visibleIds: a Set of ids, OR a plain {id:true} map (connectedSet in
  // interactivity.js builds the latter) — null/undefined = everything visible.
  const vis = (id) => unfiltered
    || (typeof visibleIds.has === 'function' ? visibleIds.has(id) : !!visibleIds[id]);
  const registry = placeCards(model);
  const cards = registry.filter((c) => vis(c.id));
  const some = (kind, index) => cards.some((c) => c.kind === kind
    && (index === undefined || (c.row.kind === kind && c.row.index === index)));
  const inRow = (rowKind, index) => cards.some((c) => c.row.kind === rowKind && c.row.index === index);

  const T = columns.length;
  const R = roles.length;
  const P = subprocesses.length;

  // Column activity + x-geometry: a column collapses to zero width when no
  // visible card sits in it. colCenterX(i) is column i's center within the
  // collapsed strip (unfiltered: GUT + i*COL + COL/2 === COL*(i+1), the
  // original formula).
  const colActive = columns.map((_, i) => cards.some((c) => c.col === i));
  const activeBefore = (i) => colActive.slice(0, i).filter(Boolean).length;
  const width = GUT + colActive.filter(Boolean).length * COL;
  const colCenterX = (i) => GUT + activeBefore(i) * COL + COL / 2;

  // Row heights (top to bottom). Zero height = row is dropped from the table.
  const timeH = TIME_H;
  const botsH = (hasBots && (unfiltered || some('tr'))) ? BOTS_H : 0;
  const standaloneH = (model.standaloneUis.length && (unfiltered || some('standalone-ui')))
    ? STANDALONE_H : 0;
  const roleHeights = roles.map((_, r) => ((unfiltered || inRow('role', r)) ? ROLE_H : 0));

  // The System row is a pure routing band (it never holds cards). It exists
  // iff the model has automation AND some visible edge still routes through
  // the band: an "observes-cmd" edge (automated command + its observed event
  // both visible) or a "translates-cmd" edge (translator card + its command
  // both visible). Unfiltered this reduces to `hasSystem`.
  const sysBandNeeded = model.commands.some((c) => c.observes && vis(c.id) && vis(c.observes))
    || model.translatorBoxes.some((b) => vis(b.elementId) && vis(b.cmdId));
  const sysH = (hasSystem && (unfiltered || sysBandNeeded)) ? SYS_H : 0;

  // Content-height rows: re-fit to the tallest visible card in the row.
  // (Mid-row heights come from the model arrays, not the registry, so a
  // command with no Produces: — never placed in a column, hence not in the
  // registry — still counts exactly as it does in the static layout.)
  const midHeights = [
    ...model.commands.map((c) => ({ id: c.id, h: c._h })),
    ...model.readmodels.map((r) => ({ id: r.id, h: r._h })),
  ].filter((x) => vis(x.id));
  const midRowPresent = unfiltered || cards.some((c) => c.row.kind === 'mid');
  const midRowH = midRowPresent
    ? rowHeightFor(Math.max(0, ...midHeights.map((x) => x.h)), MID_H) : 0;
  const procHeights = subprocesses.map((sp, g) => {
    const hs = cards.filter((c) => c.row.kind === 'proc' && c.row.index === g).map((c) => c.h);
    return hs.length ? rowHeightFor(Math.max(0, ...hs), PROC_H) : 0;
  });
  const extSysHeights = externalSystems.map((sys, g) => {
    const hs = cards.filter((c) => c.row.kind === 'ext' && c.row.index === g).map((c) => c.h);
    return hs.length ? rowHeightFor(Math.max(0, ...hs), EXT_SYS_H) : 0;
  });

  // Cumulative row tops (collapsed rows add nothing).
  const rolesTop = timeH + botsH + standaloneH;
  const roleTop = (r) => rolesTop + roleHeights.slice(0, r).reduce((a, b) => a + b, 0);
  const sysTop = rolesTop + roleHeights.reduce((a, b) => a + b, 0);
  const midRowTop = sysTop + sysH;
  const processTop = midRowTop + midRowH;
  const procGroupTop = (g) => processTop + procHeights.slice(0, g).reduce((a, b) => a + b, 0);
  const extTop = processTop + procHeights.reduce((a, b) => a + b, 0);
  const extGroupTop = (g) => extTop + extSysHeights.slice(0, g).reduce((a, b) => a + b, 0);
  const height = extTop + extSysHeights.reduce((a, b) => a + b, 0);

  return {
    T, R, P, width, height, midRowTop, processTop, midRowH, procHeights,
    standaloneH, botsH, timeH, sysH, roleHeights, colActive,
    extTop, extSysHeights, extGroupTop, procGroupTop,
    registry, cards, vis,
    colCenterX,
    botsCenterY: () => timeH + botsH / 2,
    roleCenterY: (r) => roleTop(r) + roleHeights[r] / 2,
    sysCenterY: () => sysTop + sysH / 2,
    midCenterY: () => midRowTop + midRowH / 2,
    procCenterY: (g) => procGroupTop(g) + procHeights[g] / 2,
    extCenterY: (g) => extGroupTop(g) + extSysHeights[g] / 2,
  };
}

// ---------------------------------------------------------------------------
// Exports (CommonJS in Node, window.EMLayout in the browser)
// ---------------------------------------------------------------------------

const EMLayout = {
  // constants (re-exported for generate.js / tests)
  GUT, COL, TIME_H, ROLE_H, SYS_H, MID_H, PROC_H, BOTS_H, EXT_SYS_H,
  UI_W, UI_H, STANDALONE_H, CMD_W, CMD_H, AGG_ID_H,
  EVT_W, EVT_H, EXT_EVT_W, EXT_EVT_BASE_H, TR_W, TR_H, TR_TYPE_H,
  VIEW_W, VIEW_H, RADIUS, TRANS_LINE,
  FIELD_LINE_H, FIELD_PAD, MAX_FIELDS, ROW_MARGIN,
  // helpers
  fieldsBlockHeight, cardHeight, rowHeightFor,
  isDoubleQuestionField, stripDoubleQuestion, escapeHtml,
  fieldsHtml, idKeyLinesHtml, actorsHtml,
  triggerUiElementId, outputUiElementId, translatorElementId,
  colIndexForEvent, colIndexForView, colIndexForExt,
  // layout
  placeCards, computeGeometry,
  // render
  renderTable, renderArrows, renderSvg, wrapInnerHtml,
};
if (typeof module === 'object' && module.exports) module.exports = EMLayout;
if (typeof globalThis === 'object') globalThis.EMLayout = EMLayout;

// Lane tints
const ROLE_TINTS = ['#ffe0ec', '#e2e9f5', '#fde7d0', '#e0f0ff', '#f0e0ff'];
const PROC_TINTS = ['#fdf3d3', '#e4f4dc', '#e0e8f7', '#f7e0ec', '#e8f0e0'];
const EXT_SYS_TINTS = ['#efe7f8', '#e4f0e6', '#f8e7e4', '#e4e8f0', '#f0f0e4'];
const roleColor = (r) => ROLE_TINTS[r % ROLE_TINTS.length];
const procColor = (g) => PROC_TINTS[g % PROC_TINTS.length];
const extSysColor = (g) => EXT_SYS_TINTS[g % EXT_SYS_TINTS.length];

// ---------------------------------------------------------------------------
// Render: table rows
// ---------------------------------------------------------------------------
function renderTable(model, geo) {
  const { commands, events, readmodels, uiById, triggerUiForCommand, uis, uiPlacementCol, eventProducer, commandPrimaryEvent, columns, midRow, roles, hasSystem, subprocesses, standaloneUis, hasBots, translatorBoxes, externalSystems, externalEvents } = model;
  const vis = geo.vis;

  // Collapsed columns (no visible card) get width 0 — the cell stays but
  // leaves no gap. Unfiltered every colActive is true => identical output.
  const colgroup = `<col style="width:${GUT}px">`
    + columns.map((c, i) => `<col style="width:${geo.colActive[i] ? COL : 0}px">`).join('');

  let timeCells = `<td class="gutter"></td>`;
  let n = 0;
  columns.forEach((c) => {
    if (c.type === 'event') {
      // Badge numbers are story positions (Q1: keep original numbering), so
      // `n` counts every event column — but a badge renders only while its
      // event card is visible.
      n += 1;
      timeCells += vis(c.eventId)
        ? `<td class="time-cell"><div class="time-badge">${n}</div></td>`
        : `<td class="time-cell"></td>`;
    } else {
      timeCells += `<td class="time-cell"></td>`;
    }
  });
  const timeRow = `<tr style="height:${TIME_H}px">${timeCells}</tr>`;

  // Bots swimlane (very top): all translators live here. One card per
  // (translator, produced command) pair, sitting directly above the produced
  // command's column; multiple translators producing the same command fan in
  // side by side, mirroring the trigger-UI fan-in convention.
  let botsRow = '';
  if (hasBots && geo.botsH > 0) {
    const boxesByCol = {};
    translatorBoxes.filter((b) => vis(b.elementId)).forEach((b) => {
      (boxesByCol[b.colIdx] || (boxesByCol[b.colIdx] = [])).push(b);
    });
    let cells = `<td class="gutter bots-gutter">Bots</td>`;
    columns.forEach((c, i) => {
      const boxes = boxesByCol[i] || [];
      let content = '';
      if (boxes.length) {
        const cards = boxes.map((b) => {
          // Optional free-form `Type:` label — same display-hint treatment as
          // a UI card's Type:, just on the translator's teal background.
          const typeLabel = b.tr.typeHint ? `<div class="ui-label">${escapeHtml(String(b.tr.typeHint).toUpperCase())}</div>` : '';
          return `<div class="card tr-card" style="height:${b.tr._h}px" data-element="${b.elementId}" data-ui-id="${b.tr.id}" data-type="tr" title="${b.tr.id} → ${b.cmdId} — click to focus, click again to clear"><div class="tr-badge">⚙</div>${typeLabel}<div class="title">${escapeHtml(b.tr.name || b.tr.id)}</div>${fieldsHtml(b.tr.fields)}</div>`;
        }).join('');
        content = boxes.length > 1 ? `<div class="ui-fanin-row">${cards}</div>` : cards;
      }
      cells += `<td class="lane-cell bots-cell">${content}</td>`;
    });
    botsRow = `<tr style="height:${geo.botsH}px">${cells}</tr>`;
  }

  // Standalone UIs row: cards defined in uis.md with no `Triggers:` wiring
  // (or whose trigger slot was already claimed by another UI) and no
  // read-model view wiring. Rather than dropping them, they get their own
  // dedicated row right under the time row, laid out left-to-right in a
  // single spanning cell — there's no natural column for them since they
  // don't relate to any specific event/command/view column.
  let standaloneRow = '';
  if (standaloneUis.length && geo.standaloneH > 0) {
    const cards = standaloneUis.filter((u) => vis(`ui-${u.id}`)).map((u) => {
      const label = u.typeHint ? u.typeHint.toUpperCase() : 'UI';
      return `<div class="card ui-card standalone-ui" data-element="ui-${u.id}" data-type="ui" title="ui-${u.id} — standalone UI (no Triggers:, no view) — click to focus, click again to clear"><div class="ui-label">${escapeHtml(label)}</div><div class="title">${escapeHtml(u.name || u.id)}</div>${u.actors && u.actors.length ? `<div class="caption">${actorsHtml(u.actors)}</div>` : ''}</div>`;
    }).join('');
    standaloneRow = `<tr style="height:${geo.standaloneH}px"><td class="gutter standalone-gutter">Unwired UIs</td><td class="lane-cell standalone-cell" colspan="${columns.length}"><div class="standalone-row">${cards}</div></td></tr>`;
  }

  const roleRows = roles.map((role, r) => {
    if (geo.roleHeights[r] <= 0) return '';
    const roleLabel = actorsHtml(role.actors);
    let cells = `<td class="gutter role-gutter" style="background:${roleColor(r)}">${roleLabel}</td>`;
    columns.forEach((c, i) => {
      let content = '';
      if (c.type === 'event') {
        const cmd = eventProducer[c.eventId];
        // The trigger UI cards for a command render only at its primary
        // (leftmost) produced event's column — the command card lives there,
        // so the UI stack stays above it even when the command produces
        // several events.
        if (cmd && cmd.actorKey === role.key && commandPrimaryEvent[cmd.id] === c.eventId) {
          // Fan-in: a command may be triggered by more than one UI (e.g. an
          // explicit Triggers: claim plus an id-match claim, or several
          // distinct entry-point scenarios) — render one box per triggering
          // UI, side by side, in this same cell.
          const triggerUis = (triggerUiForCommand[cmd.id] || [{ id: cmd.id, name: cmd.name, typeHint: undefined }])
            .filter((ui) => vis(triggerUiElementId(ui.id, cmd.id)));
          const cards = triggerUis.map((ui) => {
            const label = ui && ui.typeHint ? ui.typeHint.toUpperCase() : 'UI';
            const uiId = ui.id;
            const elementId = triggerUiElementId(uiId, cmd.id);
            return `<div class="card ui-card" data-element="${elementId}" data-ui-id="${uiId}" data-type="ui" title="ui-${uiId} → ${cmd.id} — click to focus, click again to clear"><div class="ui-label">${escapeHtml(label)}</div><div class="title">${escapeHtml(ui.name || cmd.name)}</div></div>`;
          }).join('');
          content = triggerUis.length > 1 ? `<div class="ui-fanin-row">${cards}</div>` : cards;
        }
      }
      // Output UI (e.g. a pdf/html screen projected from one or more read
      // models — see ConsistsOf:), placed by column index rather than by
      // matching a single read model's column, so it also works when its
      // own id doesn't equal any read model id (a purely composite UI).
      if (!content) {
        const outUi = uis.find((u) => uiPlacementCol[u.id] === i && u.actorKey === role.key
          && vis(outputUiElementId(u.id)));
        if (outUi) {
          const label = outUi.typeHint ? outUi.typeHint.toUpperCase() : 'UI';
          const elementId = outputUiElementId(outUi.id);
          content = `<div class="card ui-card" data-element="${elementId}" data-ui-id="${outUi.id}" data-type="ui" title="ui-${outUi.id} ← read model(s) — click to focus, click again to clear"><div class="ui-label">${escapeHtml(label)}</div><div class="title">${escapeHtml(outUi.name || outUi.id)}</div></div>`;
        }
      }
      cells += `<td class="lane-cell" style="background:${roleColor(r)}">${content}</td>`;
    });
    return `<tr style="height:${ROLE_H}px">${cells}</tr>`;
  }).join('\n');

  let systemRow = '';
  if (hasSystem && geo.sysH > 0) {
    let cells = `<td class="gutter sys-gutter">System</td>`;
    columns.forEach(() => { cells += `<td class="lane-cell sys-cell"></td>`; });
    systemRow = `<tr style="height:${SYS_H}px">${cells}</tr>`;
  }

  let midCells = `<td class="gutter mid-gutter"></td>`;
  columns.forEach((c, i) => {
    const occ = midRow[i];
    let content = '';
    if (occ && occ.type === 'cmd' && vis(occ.id)) {
      const cmd = commands.find((cc) => cc.id === occ.id);
      const isSystem = !!cmd.observes;
      content = `<div class="card cmd-card${isSystem ? ' system-cmd' : ''}" style="height:${cmd._h}px" data-element="${cmd.id}" data-type="cmd" title="${cmd.id} — click to focus, click again to clear">${isSystem ? '<div class="sys-badge">⚙ SYSTEM</div>' : ''}<div class="title">${escapeHtml(cmd.name)}</div>${cmd.aggregateId ? `<div class="agg-id">${escapeHtml(cmd.aggregateId)}:Id</div>` : ''}${fieldsHtml(cmd.fields)}</div>`;
    } else if (occ && occ.type === 'view' && vis(occ.id)) {
      const rm = readmodels.find((rr) => rr.id === occ.id);
      const gwtBadge = rm.gwt ? `<div class="gwt-badge" data-gwt="${rm.id}" title="Click to view GWT scenarios">GWT</div>` : '';
      content = `<div class="card view-card" style="height:${rm._h}px" data-element="${rm.id}" data-type="view" title="${rm.id} — click to focus, click again to clear"><div class="title">${escapeHtml(rm.name)}</div>${idKeyLinesHtml(rm)}${fieldsHtml(rm.fields)}${gwtBadge}</div>`;
    }
    midCells += `<td class="lane-cell mid-cell">${content}</td>`;
  });
  const midRowHtml = geo.midRowH > 0 ? `<tr class="mid-row" style="height:${geo.midRowH}px">${midCells}</tr>` : '';

  const processRows = subprocesses.map((sp, g) => {
    if (geo.procHeights[g] <= 0) return '';
    let cells = `<td class="gutter proc-gutter" style="background:${procColor(g)}">${escapeHtml(sp)} process</td>`;
    columns.forEach((c) => {
      let content = '';
      if (c.type === 'event') {
        const ev = events.find((e) => e.id === c.eventId);
        if (ev.subprocess === sp && vis(ev.id)) {
          content = `<div class="card evt-card" style="height:${ev._h}px" data-element="${ev.id}" data-type="evt" title="${ev.id} — click to focus, click again to clear"><div class="title">${escapeHtml(ev.name)}</div><div class="agg-id">${escapeHtml(ev.aggregateId)}:Id</div>${fieldsHtml(ev.fields)}</div>`;
        }
      }
      cells += `<td class="lane-cell" style="background:${procColor(g)}">${content}</td>`;
    });
    return `<tr style="height:${geo.procHeights[g]}px">${cells}</tr>`;
  }).join('\n');

  // External-system swimlanes (bottom): one row per `System name:` from
  // external-events.md. External events are NOT required to carry :Id, so the
  // card only renders it when the model actually declared one.
  const externalRows = externalSystems.map((sys, g) => {
    if (geo.extSysHeights[g] <= 0) return '';
    let cells = `<td class="gutter ext-gutter" style="background:${extSysColor(g)}">${escapeHtml(sys)}</td>`;
    columns.forEach((c) => {
      let content = '';
      if (c.type === 'ext') {
        const ev = externalEvents.find((e) => e.id === c.extId);
        if (ev && ev.systemName === sys && vis(`ext-${ev.id}`)) {
          const idLine = ev.aggregateId ? `<div class="agg-id">${escapeHtml(ev.aggregateId)}:Id</div>` : '';
          content = `<div class="card ext-card" style="height:${ev._h}px" data-element="ext-${ev.id}" data-type="ext" title="${ev.id} — external event from ${sys} — click to focus, click again to clear"><div class="title">${escapeHtml(ev.name)}</div>${idLine}${fieldsHtml(ev.fields)}</div>`;
        }
      }
      cells += `<td class="lane-cell" style="background:${extSysColor(g)}">${content}</td>`;
    });
    return `<tr style="height:${geo.extSysHeights[g]}px">${cells}</tr>`;
  }).join('\n');

  // The table carries its OWN width (like the <svg> carries width/viewBox):
  // the browser re-render replaces the whole fragment for a filtered layout,
  // so it must not depend on a stylesheet width baked at generation time —
  // that would stretch the columns and pull the cards out from under the
  // (correctly computed) arrow coordinates.
  return `<table style="width:${geo.width}px">\n<colgroup>${colgroup}</colgroup>\n${timeRow}\n${botsRow}\n${standaloneRow}\n${roleRows}\n${systemRow}\n${midRowHtml}\n${processRows}\n${externalRows}\n</table>`;
}

// ---------------------------------------------------------------------------
// 5. Arrows
// ---------------------------------------------------------------------------

function renderArrows(model, geo) {
  const { commands, events, readmodels, uiById, triggerUiForCommand, uis, uiSources, uiPlacementCol, eventProducer, commandPrimaryEvent, columns, roles, subprocesses, externalEvents, externalSystems, translatorBoxes } = model;
  // Pure helper bindings (model JSON carries no function members).
  const colIndexForEvent = (eventId) => model.columns.findIndex((c) => c.type === 'event' && c.eventId === eventId);
  const colIndexForView = (viewId) => model.columns.findIndex((c) => c.type === 'view' && c.viewId === viewId);
  const colIndexForExt = (extId) => model.columns.findIndex((c) => c.type === 'ext' && c.extId === extId);
  const vis = geo.vis;
  const arrows = [];
  const roleIndexByKey = (key) => roles.findIndex((rr) => rr.key === key);

  columns.forEach((c, i) => {
    if (c.type !== 'event') return;
    const ev = events.find((e) => e.id === c.eventId);
    const cmd = eventProducer[ev.id];
    if (!cmd) return; // orphan — already a hard error in buildModel
    const evGroup = subprocesses.indexOf(ev.subprocess);
    const evTop = geo.procCenterY(evGroup) - ev._h / 2;

    // The single command card lives at the primary (leftmost) produced
    // event's column; trigger and automation arrows originate there and are
    // drawn exactly once. The first produces-edge is the plain vertical
    // stack; each later produced event gets a routed edge from that card.
    const isPrimary = commandPrimaryEvent[cmd.id] === ev.id;
    const cmdIdx = colIndexForEvent(commandPrimaryEvent[cmd.id]);
    const cx = geo.colCenterX(cmdIdx);
    const midTop = geo.midCenterY() - cmd._h / 2;
    const midBottom = geo.midCenterY() + cmd._h / 2;

    if (isPrimary) {
      if (!cmd.observes) {
        // A command with no matching uis.md entry (no id-match, no Triggers:)
        // has no actor, hence no UI card and no swimlane row — and therefore
        // no trigger arrow. Only commands with a real trigger UI get one.
        if (cmd.actorKey !== undefined) {
          const r = roleIndexByKey(cmd.actorKey);
          const roleBottom = geo.roleCenterY(r) + UI_H / 2;
          // Fan-in: draw one arrow per triggering UI, each anchored under its
          // own box's x position within the fanned-in row (mirrors the CSS
          // layout in renderTable's .ui-fanin-row: boxes centered on cx, laid
          // out left-to-right with a fixed gap). Hidden boxes are dropped
          // BEFORE the geometry so the survivors re-center.
          const triggerUis = (triggerUiForCommand[cmd.id] || [{ id: cmd.id }])
            .filter((ui) => vis(triggerUiElementId(ui.id, cmd.id)));
          const K = triggerUis.length;
          const GAP = 8;
          const totalW = K * UI_W + (K - 1) * GAP;
          triggerUis.forEach((ui, k) => {
            const boxCx = K > 1 ? (cx - totalW / 2 + UI_W / 2 + k * (UI_W + GAP)) : cx;
            arrows.push({ x1: boxCx, y1: roleBottom, x2: cx, y2: midTop, from: triggerUiElementId(ui.id, cmd.id), to: cmd.id, marker: 'arrow', kind: 'triggers' });
          });
        }
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
          from: cmd.observes, to: cmd.id, dashed: true, marker: 'arrow-purple', kind: 'observes-cmd',
        });
      }
    }

    if (isPrimary) {
      arrows.push({ x1: cx, y1: midBottom, x2: cx, y2: evTop, from: cmd.id, to: ev.id, marker: 'arrow', kind: 'produces' });
    } else {
      // A later produced event shares its command card with an earlier
      // column: route the produces-edge sideways through the card-free band
      // below the mid-row (mirroring the read-model/UI sideways-routing
      // pattern), then down into this event's top edge.
      const evCx = geo.colCenterX(i);
      const bandY = Math.min(geo.midCenterY() + geo.midRowH / 2 + 20, evTop - 15);
      arrows.push({
        polyline: [[cx, midBottom], [cx, bandY], [evCx, bandY], [evCx, evTop]],
        from: cmd.id, to: ev.id, marker: 'arrow', kind: 'produces',
      });
    }
  });

  readmodels.forEach((rm) => {
    const rmIdx = columns.findIndex((c) => c.type === 'view' && c.viewId === rm.id);
    const rmCx = geo.colCenterX(rmIdx);
    const rmCy = geo.midCenterY();

    const entries = { left: [], right: [], bottom: [] };
    // Hidden source events are dropped BEFORE the spread math so the
    // surviving arrows re-spread evenly along the read model's edge.
    (rm.subscribes || []).filter((evId) => vis(evId)).forEach((evId) => {
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
          from: ev.id, to: rm.id, purpleNoMarker: true, kind: 'observes',
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
    if (!srcs || !ui.actorKey) return;
    const r = roleIndexByKey(ui.actorKey);
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
        arrows.push({ x1: rmCx, y1: rmTop, x2: uiCx, y2: roleBottom, from: rm.id, to: outputUiElementId(ui.id), marker: 'arrow', kind: 'displays' });
      } else {
        const exitX = idx < placementIdx ? rmCx + VIEW_W / 2 - RADIUS : rmCx - VIEW_W / 2 + RADIUS;
        const bandY = roleBottom + 15; // card-free band just below the role row
        arrows.push({
          polyline: [[exitX, rmTop], [exitX, bandY], [uiCx, bandY], [uiCx, roleBottom]],
          from: rm.id, to: outputUiElementId(ui.id), marker: 'arrow',
          kind: 'displays',
        });
      }
    });
  });

  // Translation Pattern (external events -> translators -> commands).
  // Translator cards sit in the Bots row at the very top, directly above the
  // command they produce; external events live in the bottom external-system
  // lanes, in columns inserted left of the command they feed.
  translatorBoxes.forEach((box) => {
    const trCx = geo.colCenterX(box.colIdx);
    const trBottom = geo.botsCenterY() + box.tr._h / 2;
    const cmd = commands.find((c) => c.id === box.cmdId);
    if (!cmd) return;
    const midTop = geo.midCenterY() - cmd._h / 2;
    // Translator -> command: route down the column's right edge to a card-free
    // band (the System row when present, else just above the mid-row), across,
    // then down into the command's top edge — mirrors the automation routing
    // and keeps the column center line free for any human trigger UI.
    const cmdBandY = geo.sysH > 0 ? geo.sysCenterY() : geo.midRowTop - 15;
    // Exit the translator card's bottom edge, run sideways into the column's
    // RIGHT GUTTER (x = center + COL/2 - 20), then down the gutter to the
    // card-free System-row band, across, and a short drop into the command top
    // — mirrors the automation arrow and never slices through a human trigger
    // UI card at that column (UI cards span ±UI_W/2 around the column center).
    const trExitX = trCx + TR_W / 2 - RADIUS;
    const trGutterX = trCx + COL / 2 - 20;
    arrows.push({
      polyline: [[trExitX, trBottom], [trGutterX, trBottom], [trGutterX, cmdBandY], [trCx, cmdBandY], [trCx, midTop]],
      from: box.elementId, to: cmd.id, color: TRANS_LINE, marker: 'arrow-teal', kind: 'translates-cmd',
    });
    // External event -> translator: rise from the external event's top edge to
    // a card-free band just below the Bots row, across to the translator
    // column, then up into the translator card's bottom edge. A fan-out
    // (translator producing several commands) draws one arrow per command box;
    // a fan-in (several translators subscribing the same external event) draws
    // one arrow per subscribing translator box.
    (box.tr.subscribes || []).forEach((extId) => {
      const extIdx = colIndexForExt(extId);
      if (extIdx === -1) return;
      const ext = externalEvents.find((e) => e.id === extId);
      if (!ext) return;
      const extGroup = externalSystems.indexOf(ext.systemName);
      const extCx = geo.colCenterX(extIdx);
      const extTop = geo.extCenterY(extGroup) - ext._h / 2;
      const extExitX = extCx + EXT_EVT_W / 2 - RADIUS; // top-right corner, inset
      const transBandY = geo.timeH + geo.botsH + 10; // card-free band just below the Bots row (follows a collapsed bots row)
      arrows.push({
        polyline: [[extExitX, extTop], [extExitX, transBandY], [trCx, transBandY], [trCx, trBottom]],
        from: `ext-${ext.id}`, to: box.elementId, dashed: true, color: TRANS_LINE, marker: 'arrow-teal', kind: 'translates',
      });
    });
  });

  // Uniform visibility rule (same predicate the old dim filter used): an
  // arrow is drawn iff BOTH endpoint cards are visible — hidden endpoints
  // mean the arrow disappears with them, no ghost lines.
  return arrows.filter((a) => vis(a.from) && vis(a.to)).map((a) => {
    const dashAttr = a.dashed ? ' stroke-dasharray="6,4"' : '';
    const color = a.color || (a.dashed || a.purpleNoMarker ? '#5E35B1' : '#333333');
    const markerAttr = a.marker ? ` marker-end="url(#${a.marker})"` : '';
    const kindAttr = a.kind ? ` data-kind="${a.kind}"` : '';
    if (a.polyline) {
      const pts = a.polyline.map((p) => p.join(',')).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"${dashAttr}${markerAttr} data-from="${a.from}" data-to="${a.to}"${kindAttr}/>`;
    }
    return `<line x1="${a.x1}" y1="${a.y1}" x2="${a.x2}" y2="${a.y2}" stroke="${color}" stroke-width="2"${markerAttr} data-from="${a.from}" data-to="${a.to}"${kindAttr}/>`;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// SVG shell + full wrap content
// ---------------------------------------------------------------------------
//
// renderSvg(geo, arrowsHtml) reproduces the <svg> overlay exactly as
// renderPage assembles it (markers + arrows), so the static page and every
// browser re-render share one string builder.

function renderSvg(geo, arrowsHtml) {
  return `<svg width="${geo.width}" height="${geo.height}" viewBox="0 0 ${geo.width} ${geo.height}">
<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#333333"/></marker>
<marker id="arrow-purple" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#5E35B1"/></marker>
<marker id="arrow-teal" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="#00796B"/></marker>
</defs>
${arrowsHtml}
</svg>`;
}

// wrapInnerHtml(model, visibleIds) -> { geo, html } — the complete contents of
// <div class="wrap"> for the given visible card set (null = everything).
// This is the single re-render entry point used by EM_RENDER in the browser.
function wrapInnerHtml(model, visibleIds) {
  const geo = computeGeometry(model, visibleIds);
  const tableHtml = renderTable(model, geo);
  const arrowsHtml = renderArrows(model, geo);
  return { geo, html: `${tableHtml}\n${renderSvg(geo, arrowsHtml)}` };
}
