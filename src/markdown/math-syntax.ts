import { isInlineMath } from './engine/inline-math';

const DISPLAY_MATH = /\$\$[\s\S]+?\$\$/;

export { isInlineMath };

/**
 * Does the source look like it carries math? Math syntax is on only then.
 *
 * Looser than the parser (it ignores escapes and dollar runs), which then
 * applies the real rule to each span. Without the gate a lone `$$` line would
 * open a math block that swallows the rest of the text.
 * @param md - Markdown source
 */
export const hasMathSignal = (md: string): boolean =>
  DISPLAY_MATH.test(md) || md.split('$').slice(1, -1).some(isInlineMath);
