// Advisory engine for logic classes (Handlers, Projectors, Repositories, Entities).
//
// Philosophy: "Generate on initial create, advise with exact prompts on drift"
//
// When a class with logic already exists on disk and the model evolves:
// 1. Never silently overwrite or destroy custom developer code.
// 2. Identify missing members (e.g. new event subscriptions, new queries) and
//    drifted members (e.g. updated event constructors in handlers).
// 3. Return an exact, actionable prompt with ready-to-copy code snippets.

import {
  splitTopLevelMembers,
  memberKey,
  splitFile,
  semanticDrift,
} from './merge.js';
import { preservedReason } from './scaffold.js';

/**
 * Returns true if the emitted file is a logic-holding class where
 * developer customizations should be preserved and changes advised.
 */
export function isLogicFile(file) {
  if (file.logic === true) return true;
  if (file.once === true) return true;
  return false;
}

/**
 * Compare current file content on disk with freshly generated content
 * from the model, and produce an advisory report if drift is detected.
 *
 * @param {object} params
 * @param {string} params.currentContent - File content on disk
 * @param {string} params.generatedContent - Emitted content from model
 * @param {string} params.relPath - Relative path to file for display
 * @returns {object|null} Advisory report object, or null if in sync
 */
export function computeAdvisory({ currentContent, generatedContent, relPath }) {
  if (currentContent === generatedContent) return null;

  const reason = preservedReason(currentContent);
  if (reason) {
    return {
      relPath,
      isPreserved: true,
      reason,
    };
  }

  const existingSplit = splitFile(currentContent);
  const generatedSplit = splitFile(generatedContent);

  if (!existingSplit || !generatedSplit) {
    return {
      relPath,
      hasDrift: true,
      isMalformed: true,
      prompt: `File ${relPath} has an unrecognised structure or syntax error. Reconcile it manually.`,
    };
  }

  const existingMembers = splitTopLevelMembers(existingSplit.body);
  const generatedMembers = splitTopLevelMembers(generatedSplit.body);

  const existingMemberMap = new Map();
  for (const m of existingMembers) {
    const k = memberKey(m);
    if (!existingMemberMap.has(k)) existingMemberMap.set(k, m);
  }

  const generatedMemberMap = new Map();
  for (const m of generatedMembers) {
    const k = memberKey(m);
    if (!generatedMemberMap.has(k)) generatedMemberMap.set(k, m);
  }

  const missingMembers = [];
  const driftedMembers = [];

  for (const [key, genMember] of generatedMemberMap.entries()) {
    if (!existingMemberMap.has(key)) {
      missingMembers.push({ key, snippet: genMember.trim() });
    }
  }

  const driftKeys = semanticDrift(currentContent, generatedContent);
  for (const key of driftKeys) {
    const genMember = generatedMemberMap.get(key);
    const currMember = existingMemberMap.get(key);
    if (genMember && currMember) {
      driftedMembers.push({
        key,
        currentSnippet: currMember.trim(),
        expectedSnippet: genMember.trim(),
      });
    }
  }

  if (missingMembers.length === 0 && driftedMembers.length === 0) {
    return null;
  }

  const promptSections = [];
  promptSections.push(
    `HAND-OWNED FILE — \`${relPath}\` differs from the event model.\n` +
      `Not a request to "sync" the file. Apply the per-section rule below; the two\n` +
      `sections have OPPOSITE rules. When in doubt, do nothing and report.`,
  );

  if (missingMembers.length > 0) {
    promptSections.push(
      `\n### ADDITIVE — in the model, absent here. Agent MAY add these.\n` +
        `Adding a member cannot destroy existing logic. Add one only when it is\n` +
        `actually needed: the file no longer compiles without it, or a test needs the\n` +
        `new model capability. Do not bulk-paste the rest.`,
    );
    for (const m of missingMembers) {
      promptSections.push(`\nMember \`${m.key}\`:\n\`\`\`java\n${m.snippet}\n\`\`\``);
    }
  }

  if (driftedMembers.length > 0) {
    promptSections.push(
      `\n### EXISTING LOGIC — do NOT rewrite. This is hand-written work.\n` +
        `Never paste the model's version over a member that already exists; that is\n` +
        `destroying the developer's logic, even if the model "looks right".\n` +
        `ONLY exception: it no longer compiles after a model change. Then make the\n` +
        `MINIMAL edit that restores compilation (e.g. pass the new constructor\n` +
        `argument) and preserve the surrounding intent. Anything beyond that is the\n` +
        `developer's call.`,
    );
    for (const d of driftedMembers) {
      promptSections.push(
        `\nMember \`${d.key}\`:\n` +
          `Model's version — REFERENCE ONLY, do not apply wholesale:\n` +
          `\`\`\`java\n${d.expectedSnippet}\n\`\`\``,
      );
    }
  }

  promptSections.push(
    `\nIf the hand-written logic is intentional, the developer may add\n` +
      `\`// PRESERVED-BY-HAND: <reason>\` to silence this report. Choosing to align\n` +
      `working logic with the model is the developer's decision, not the agent's —\n` +
      `report it instead of doing it.`,
  );

  return {
    relPath,
    hasDrift: true,
    missingMembers,
    driftedMembers,
    prompt: promptSections.join('\n'),
  };
}
