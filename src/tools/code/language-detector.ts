import { tokenizeCode } from './shiki-loader';

/**
 * Languages considered for auto-detection.
 * Kept to ~15 common ones to keep detection fast.
 */
export const DETECTION_CANDIDATE_LANGUAGES = [
  'javascript',
  'typescript',
  'python',
  'java',
  'html',
  'css',
  'json',
  'bash',
  'sql',
  'rust',
  'go',
  'cpp',
  'yaml',
  'markdown',
  'php',
] as const;

/** Minimum code length (characters) before attempting detection. */
const MIN_CODE_LENGTH = 20;

/**
 * Threshold: if the winning language's fg-token ratio is above this value,
 * no meaningful detection was possible and we return null.
 * A ratio of 1.0 means all tokens are unrecognized (plain fg color).
 * A ratio of 0.75 means 75% of characters are unrecognized.
 */
const MAX_ACCEPTABLE_FG_RATIO = 0.75;

/**
 * Minimum number of distinct non-fg colors a tokenization must produce
 * to be considered a genuine match. Languages that colorize everything
 * with a single non-fg color (e.g. YAML treating code as a string block)
 * produce a deceptively low fg-ratio without actually recognizing the syntax.
 */
const MIN_DISTINCT_COLORS = 2;

/**
 * Scores how well shiki tokenized the code in a given language.
 * Returns a value in [0, 1] — lower is better (fewer unrecognized tokens),
 * or 1 if the tokenization didn't use enough distinct colors to be a real match.
 *
 * Strategy: compute the ratio of characters colored with the theme's
 * foreground color (= unrecognized/plain text) to total characters.
 * A well-matched language has many distinctly-colored tokens; a poorly-matched
 * language produces mostly fg-colored (unrecognized) tokens.
 *
 * Guard: if fewer than MIN_DISTINCT_COLORS non-fg colors appear, the grammar
 * is treating everything as the same token type (e.g. YAML string), which is
 * a false positive. Return 1 in that case.
 */
function scoreTokens(tokens: Array<Array<{ content: string; color: string }>>, fg: string): number {
  const allTokens = tokens.flat();
  const totalChars = allTokens.reduce((sum, token) => sum + token.content.length, 0);

  if (totalChars === 0) return 1;

  const { fgChars, nonFgColors } = allTokens.reduce(
    (acc, token) => ({
      fgChars: acc.fgChars + (token.color === fg ? token.content.length : 0),
      nonFgColors: token.color === fg ? acc.nonFgColors : acc.nonFgColors.add(token.color),
    }),
    { fgChars: 0, nonFgColors: new Set<string>() }
  );

  // Reject tokenizations that use fewer than MIN_DISTINCT_COLORS non-fg colors —
  // these are grammars that "colorize" everything as a single token type
  // (e.g. YAML interpreting code as block scalars), which is a false positive.
  if (nonFgColors.size < MIN_DISTINCT_COLORS) {
    return 1;
  }

  return fgChars / totalChars;
}

/**
 * Detects the most likely programming language for the given code.
 * Returns a language ID from DETECTION_CANDIDATE_LANGUAGES, or null if:
 * - code is too short
 * - shiki isn't loaded yet
 * - no language scores clearly better than plain text
 */
export async function detectLanguage(code: string): Promise<string | null> {
  if (code.length < MIN_CODE_LENGTH) {
    return null;
  }

  // Tokenize all candidate languages concurrently
  const results = await Promise.all(
    DETECTION_CANDIDATE_LANGUAGES.map(async (lang) => {
      const tokens = await tokenizeCode(code, lang);
      return { lang, tokens };
    })
  );

  const best = results.reduce<{ lang: string | null; score: number }>(
    (acc, { lang, tokens }) => {
      if (!tokens) return acc;

      const score = scoreTokens(tokens.light.tokens, tokens.light.fg);

      return score < acc.score ? { lang, score } : acc;
    },
    { lang: null, score: Infinity }
  );

  if (best.lang === null || best.score >= MAX_ACCEPTABLE_FG_RATIO) {
    return null;
  }

  return best.lang;
}
