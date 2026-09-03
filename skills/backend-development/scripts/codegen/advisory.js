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
  promptSections.push(`Update file: \`${relPath}\` to align with event model changes.`);

  if (missingMembers.length > 0) {
    promptSections.push(`\n### Missing member(s) to add:`);
    for (const m of missingMembers) {
      promptSections.push(`\n\`\`\`java\n${m.snippet}\n\`\`\``);
    }
  }

  if (driftedMembers.length > 0) {
    promptSections.push(`\n### Member(s) requiring update:`);
    for (const d of driftedMembers) {
      promptSections.push(
        `\nMember \`${d.key}\`:\n` +
          `Expected implementation from model:\n` +
          `\`\`\`java\n${d.expectedSnippet}\n\`\`\``,
      );
    }
  }

  promptSections.push(
    `\nIncorporate the changes above into \`${relPath}\` while preserving existing custom logic ` +
      `or mark with \`// PRESERVED-BY-HAND: <reason>\` if custom behavior is intentional.`,
  );

  return {
    relPath,
    hasDrift: true,
    missingMembers,
    driftedMembers,
    prompt: promptSections.join('\n'),
  };
}
