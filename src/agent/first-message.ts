import type { DocumentView, ViewArgs } from '../../types/agent';

/** The read the first message carries. A plain blok_read, capped so a big document stays cheap. */
export const OUTLINE_READ: ViewArgs = { limit: 50 };

/**
 * The assistant's first user message: the request, the document as blok_read
 * returns it, then where the user is. The eval in-app surface sends the same text.
 * @param prompt - the user's request
 * @param context - the caret or selection line; it names block ids, so it goes after the document
 * @param read - the turn's blok_read
 */
export async function composeFirstMessage(
  prompt: string,
  context: string,
  read: (args: ViewArgs) => Promise<DocumentView>
): Promise<string> {
  const outline = await read(OUTLINE_READ).then(
    (view) => {
      const more = view.next === undefined
        ? ''
        : `\nMore blocks follow: call blok_read with ${JSON.stringify({ cursor: view.next })}.`;

      return `The document, already read for you with blok_read ${JSON.stringify(OUTLINE_READ)}. Do not read it again unless you need more than this:\n${JSON.stringify(view)}${more}`;
    },
    // The run must not fail over the outline: the model can still read.
    () => ''
  );

  return [prompt, outline, context].filter((part) => part !== '').join('\n\n');
}
