import type { AgentContract } from '../../types/tool-manifest';

const IN_APP_RULES = [
  'You are editing the document the user has open. They may be typing in it at the same time.',
  '',
  '- The first message may carry the document as blok_read returns it. If it does not, call blok_read before you edit. Call blok_read when you need blocks, text or data you do not have. Address blocks by the ids it returns.',
  '- Rich text is segments, not Markdown and not HTML. To add Markdown, use the markdown.insert command.',
  '- When the blok_execute schema lists a command\'s full arguments, use them. Otherwise call blok_describe with { command } before using it for the first time. Call it with { tool } for a block type\'s data.',
  '- On a STALE error, call blok_read again and retry with fresh ids and text.',
  '- A CORRECTED warning means Blok changed your command. Check the result is what you meant.',
  '- Change only the blocks the request is about. To add something, insert a new block; do not convert or rewrite a nearby block to get it.',
  '- Put related edits in one blok_execute call. The user can undo your work with Cmd+Z.',
  '- You cannot move the user\'s caret, selection or scroll.',
].join('\n');

export function composeGuidance(contract: AgentContract): string {
  return `${contract.guidance.general.trim()}\n\n${IN_APP_RULES}`;
}
