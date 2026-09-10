#!/usr/bin/env node
import { readPayload, runHook, block, isMain, EXIT_OK } from './lib/hook-io.mjs';

const CODE_EXTENSIONS = new Set([
  '.cs', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.go', '.java', '.kt', '.swift', '.rs',
  '.c', '.h', '.cpp', '.hpp',
]);

const LEADING_COMMENT = /^[^\S\n]*(\/\/|\/\*|\*\/|\* )/;
const TRAILING_COMMENT = /[^\s][^\S\n]+\/\/([^\S\n]|$)/;

export function isCodeFile(filePath) {
  if (!filePath) return false;
  const lower = String(filePath).toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return CODE_EXTENSIONS.has(lower.slice(dot));
}

export function commentLines(text) {
  if (!text) return [];
  return String(text)
    .split(/\r?\n/)
    .filter((line) => LEADING_COMMENT.test(line) || TRAILING_COMMENT.test(line));
}

export function editPairs(toolInput) {
  const input = toolInput || {};
  if (Array.isArray(input.edits) && input.edits.length > 0) {
    return input.edits.map((edit) => ({
      next: edit?.new_string ?? '',
      prev: edit?.old_string ?? '',
    }));
  }
  return [{
    next: input.new_string ?? input.content ?? '',
    prev: input.old_string ?? '',
  }];
}

export function addedLines(structuredPatch) {
  if (!Array.isArray(structuredPatch)) return [];
  const added = [];
  for (const hunk of structuredPatch) {
    for (const line of hunk?.lines ?? []) {
      if (typeof line === 'string' && line.startsWith('+')) added.push(line.slice(1));
    }
  }
  return added;
}

export function introducedFromResponse(toolResponse) {
  const original = toolResponse?.originalFile;
  if (typeof original !== 'string') return null;
  if (!Array.isArray(toolResponse?.structuredPatch)) return null;

  const preexisting = new Set(commentLines(original));
  return commentLines(addedLines(toolResponse.structuredPatch).join('\n'))
    .filter((line) => !preexisting.has(line));
}

export function introducedComments(toolInput) {
  const introduced = [];
  for (const { next, prev } of editPairs(toolInput)) {
    const added = commentLines(next);
    if (added.length === 0) continue;
    const preexisting = new Set(commentLines(prev));
    for (const line of added) {
      if (!preexisting.has(line)) introduced.push(line);
    }
  }
  return introduced;
}

export function report(filePath, introduced) {
  const shown = introduced.slice(0, 8).map((line) => line.trim()).join('\n');
  return [
    `Comment lines introduced in ${filePath}. CLAUDE.md forbids code comments.`,
    'Remove them now (rename or extract instead of explaining):',
    shown,
  ].join('\n');
}

if (isMain(import.meta.url)) {
  runHook('no-comments', async () => {
    const payload = await readPayload();
    const filePath = payload?.tool_input?.file_path;
    if (!isCodeFile(filePath)) process.exit(EXIT_OK);

    const introduced = introducedFromResponse(payload.tool_response)
      ?? introducedComments(payload.tool_input);
    if (introduced.length === 0) process.exit(EXIT_OK);

    block(report(filePath, introduced));
  });
}
