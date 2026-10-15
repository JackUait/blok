import type { AgentContract } from '../../types/tool-manifest';

const IN_APP_RULES = [
  'You are editing the document the user has open. They may be typing in it at the same time.',
  '',
  '- Call blok_read before you edit. Address blocks by the ids it returns.',
  '- Rich text is segments, not Markdown and not HTML. To add Markdown, use the markdown.insert command.',
  '- blok_execute gives the full arguments of the common commands. Call blok_describe with { command } before using any other command for the first time, and with { tool } for a block type\'s data.',
  '- On a STALE error, call blok_read again and retry with fresh ids and text.',
  '- Put related edits in one blok_execute call. The user can undo your work with Cmd+Z.',
  '- You cannot move the user\'s caret, selection or scroll.',
].join('\n');

export function composeGuidance(contract: AgentContract): string {
  return `${contract.guidance.general.trim()}\n\n${IN_APP_RULES}`;
}
