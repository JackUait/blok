import type { Extension as MdastExtension } from 'mdast-util-from-markdown';
import type { Code, Construct, Effects, Extension as MicromarkExtension, State, TokenizeContext } from 'micromark-util-types';

const DOLLAR = 36;

/** `5/` in `$5/$month`, `5-` in `$5-$10`: a number that runs into a separator. */
const PRICE = /^\d[\s\S]*[-+/,.:;–—]$/;

const DISPLAY_MATH = /\$\$[\s\S]+?\$\$/;

/**
 * Whether the text between two single `$` is math rather than prose with
 * prices in it. Padded content (`$5 and $`) and a number that runs into a
 * separator (`$5/$`) are prose; `$2x$`, `$5 + 3$` and `$5$` are math.
 * @param content - the text between the dollars
 */
const isInlineMath = (content: string): boolean =>
  content !== '' && content.trim() === content && !PRICE.test(content);

/**
 * Does the source look like it carries math? Gates the extension load.
 *
 * Deliberately looser than the parser (it ignores escapes and dollar runs):
 * a miss here keeps real math as text, while a false hit only costs a lazy
 * import, since {@link loadMathExtensions} applies the real rule.
 * @param md - Markdown source
 */
export const hasMathSignal = (md: string): boolean =>
  DISPLAY_MATH.test(md) || md.split('$').slice(1, -1).some(isInlineMath);

/**
 * Reject a single-dollar span whose content fails {@link isInlineMath}.
 * Rejecting makes micromark retry from the closing `$`, so in
 * `costs $5 and later $x^2$` the real formula still parses.
 * @param construct - micromark-extension-math's text construct
 */
const withPriceGuard = (construct: Construct): Construct => ({
  ...construct,
  tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    const codes: Code[] = [];
    const recording: Effects = {
      ...effects,
      consume: (code: Code): undefined => {
        codes.push(code);

        return effects.consume(code);
      },
    };
    const accepted = (): boolean => {
      if (codes.findIndex((code) => code !== DOLLAR) !== 1) {
        return true;
      }

      // Negative codes are tabs, virtual spaces and line endings.
      return isInlineMath(codes.slice(1, -1).map((code) => (code !== null && code >= 0 ? String.fromCodePoint(code) : ' ')).join(''));
    };

    return construct.tokenize.call(this, recording, (code: Code) => (accepted() ? ok(code) : nok(code)), nok);
  },
});

/**
 * Lazily load the math micromark/mdast extensions, with prices kept as text.
 */
export async function loadMathExtensions(): Promise<{
  mathSyntax: MicromarkExtension;
  mathFromMarkdown: MdastExtension;
}> {
  const [{ math }, { mathFromMarkdown }] = await Promise.all([
    import('micromark-extension-math'),
    import('mdast-util-math'),
  ]);
  const syntax = math();
  const text = syntax.text?.[DOLLAR];
  const guarded = Array.isArray(text) ? text.map(withPriceGuard) : text && withPriceGuard(text);

  return {
    mathSyntax: guarded === undefined ? syntax : { ...syntax, text: { ...syntax.text, [DOLLAR]: guarded } },
    mathFromMarkdown: mathFromMarkdown(),
  };
}
