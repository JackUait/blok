import type { AgentContract } from '../../types/tool-manifest';

/** Rules for any agent editing a Blok document. The MCP server's instructions send these too. */
export const SHARED_RULES: readonly string[] = [
  '- Call blok_read when you need blocks, text or data you do not have. Address blocks by the ids it returns.',
  '- Rich text is segments, not Markdown and not HTML. To add Markdown, use the markdown.insert command.',
  '- When the blok_execute schema lists a command\'s full arguments, use them. Otherwise call blok_describe with { command } before using it for the first time. Call it with { tool } for a block type\'s data.',
  '- Someone may be typing in the document at the same time, so its text can change between your calls.',
  '- On a STALE error, call blok_read again and retry with fresh ids and text.',
  '- A CORRECTED warning means Blok changed your command. Check the result is what you meant.',
  '- Change only the blocks the request is about. To add something, insert a new block; do not convert or rewrite a nearby block to get it.',
  '- Put related edits in one blok_execute call.',
];

export const IN_APP_INTRO = 'You are editing the document the user has open.';

/** Rules only the in-app assistant gets: the user, their caret and the reply. */
export const IN_APP_RULES: readonly string[] = [
  '- The first message may carry the document as blok_read returns it. If it does not, call blok_read before you edit.',
  '- The user can undo your work with Cmd+Z.',
  '- You cannot move the user\'s caret, selection or scroll.',
  '- When the user asks a question, answer it in your reply. Edit the document only when they ask for a change.',
  '- After you edit, your whole reply is one friendly sentence of under 10 words on what you did, in the user\'s language, like "Added a short paragraph about how YouTube began." It must make sense on its own: never end it with a colon, never introduce a list, write nothing before or after it. Say what, never where: no caret, position, block names or ids. No lists, tables or Markdown.',
];

export const PAGE_RULE = '- A page block points at a sub-page with its own document. To write inside one, call blok_read or blok_execute with `page` set to the page block\'s id; there doc.setTitle and doc.setIcon name the sub-page.';

/** Both surfaces send it exactly when their contract lets a page block insert. */
export const PAGE_CREATE_RULE = '- To make a new sub-page, insert a page block without data.pageId. Blok creates its document and sets data.pageId. Then write inside it.';

export const pagesInsert = (contract: AgentContract): boolean =>
  contract.manifest.blocks.some(block => block.name === 'page' && block.insertable);

export function composeGuidance(contract: AgentContract, options: { pages?: boolean } = {}): string {
  return [
    contract.guidance.general.trim(),
    '',
    IN_APP_INTRO,
    '',
    ...SHARED_RULES,
    ...IN_APP_RULES,
    ...(options.pages === true ? [...(pagesInsert(contract) ? [PAGE_CREATE_RULE] : []), PAGE_RULE] : []),
  ].join('\n');
}
