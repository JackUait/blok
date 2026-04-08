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
 * Scores how well shiki tokenized the code in a given language.
 * Returns a value in [0, 1] — lower is better (fewer unrecognized tokens).
 *
 * Strategy: compute the ratio of characters colored with the theme's
 * foreground color (= unrecognized/plain text) to total characters.
 * A well-matched language has many distinctly-colored tokens; a poorly-matched
 * language produces mostly fg-colored (unrecognized) tokens.
 */
function scoreTokens(tokens: Array<Array<{ content: string; color: string }>>, fg: string): number {
  const allTokens = tokens.flat();
  const totalChars = allTokens.reduce((sum, token) => sum + token.content.length, 0);

  if (totalChars === 0) return 1;

  const fgChars = allTokens.reduce(
    (sum, token) => sum + (token.color === fg ? token.content.length : 0),
    0
  );

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
