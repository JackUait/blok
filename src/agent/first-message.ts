import type { DocumentView, ViewArgs } from '../../types/agent';

/** The read the first message carries. A plain blok_read, capped so a big document stays cheap. */
export const OUTLINE_READ = { limit: 50, textLimit: 120 } as const satisfies ViewArgs;

const LEFT_OUT = `Text is cut at ${OUTLINE_READ.textLimit} characters and has no formatting. For full text, formatting, table cells or other block data, call blok_read with ids.`;

/**
 * The assistant's first user message: the request, the document as blok_read
 * returns it, then where the user is. The eval in-app surface sends the same text.
 * @param prompt - the user's request
 * @param context - the caret or selection line; it names block ids, so it goes after the document
 * @param read - the turn's blok_read
 * @param focus - the blocks the context names; read by id when the outline does not reach them
 */
export async function composeFirstMessage(
  prompt: string,
  context: string,
  read: (args: ViewArgs) => Promise<DocumentView>,
  focus: readonly string[] = []
): Promise<string> {
  // The run must not fail over a read: the model can still read.
  const view = await read(OUTLINE_READ).catch(() => null);

  if (view === null) {
    return [prompt, context].filter((part) => part !== '').join('\n\n');
  }

  const more = view.next === undefined
    ? ''
    : `\nMore blocks follow: call blok_read with ${JSON.stringify({ cursor: view.next })}.`;
  const outline = `The document, read for you with blok_read ${JSON.stringify(OUTLINE_READ)}. Do not repeat that read. ${LEFT_OUT}\n${JSON.stringify(view)}${more}`;
  // Paging only goes forward, so a caret past the outline is read on its own.
  const missing = focus.filter((id) => !view.blocks.some((block) => block.id === id));
  const args: ViewArgs = { ids: missing };
  const focused = missing.length === 0
    ? ''
    : await read(args).then(
      (found) => `The blocks the user is in, read with blok_read ${JSON.stringify(args)}:\n${JSON.stringify(found)}`,
      () => ''
    );

  return [prompt, outline, focused, context].filter((part) => part !== '').join('\n\n');
}
