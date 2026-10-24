import type { AgentModel, AgentModelContentBlock, AgentModelTool } from '../../types/api';

/** The prompt asks for under 10 words; a little slack spares a rewrite for a near miss. */
const MAX_WORDS = 12;

const REWRITE_RULES = [
  'You shorten the note an editing assistant wrote after it changed a document.',
  'Reply with only the new note: one friendly sentence of under 10 words on what was done, in the note\'s language.',
  'Keep the main thing done. Drop the details, counts and lists. No Markdown, no quotes around it, nothing before or after it. Do not call tools.',
].join('\n');

/** Intl.Segmenter splits words in languages written without spaces too. */
const wordCount = (text: string): number => [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)]
  .filter((segment) => segment.isWordLike === true)
  .length;

/** After an edit the bar shows only the note's first line. */
const firstLine = (note: string): string => note.trim().split('\n')[0].trim();

/** A note whose shown line would not fit the bar as one short line. */
export const isLongNote = (note: string): boolean => wordCount(firstLine(note)) > MAX_WORDS;

const textOf = (content: AgentModelContentBlock[]): string => content
  .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
  .join('')
  .trim();

/**
 * Ask the model for a short version of a long note: one call, with no history.
 * Null when it fails or comes back long too: the caller keeps the note whole, it is never cut.
 * @param tools - the run's tools, unused: an adapter may send an empty list on, and a provider may reject it
 */
export const shortenNote = async (model: AgentModel, note: string, tools: AgentModelTool[], signal: AbortSignal): Promise<string | null> => {
  try {
    const response = await model({ system: REWRITE_RULES, messages: [{ role: 'user', content: firstLine(note) }], tools, signal });
    const short = Array.isArray(response.content) ? textOf(response.content) : '';

    return short === '' || isLongNote(short) ? null : short;
  } catch {
    return null;
  }
};
