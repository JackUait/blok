import type { HighlightToken, DualThemeTokens, ThemeTokens } from './highlight-applier';
import { HIGHLIGHTABLE_LANGUAGES, SHIKI_LIGHT_THEME, SHIKI_DARK_THEME } from './constants';

const LANG_IMPORTS: Record<string, () => Promise<unknown>> = {
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  python: () => import('@shikijs/langs/python'),
  java: () => import('@shikijs/langs/java'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  ruby: () => import('@shikijs/langs/ruby'),
  php: () => import('@shikijs/langs/php'),
  swift: () => import('@shikijs/langs/swift'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  sql: () => import('@shikijs/langs/sql'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  markdown: () => import('@shikijs/langs/markdown'),
  bash: () => import('@shikijs/langs/shellscript'),
  shell: () => import('@shikijs/langs/shellscript'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  xml: () => import('@shikijs/langs/xml'),
  graphql: () => import('@shikijs/langs/graphql'),
  r: () => import('@shikijs/langs/r'),
  scala: () => import('@shikijs/langs/scala'),
  dart: () => import('@shikijs/langs/dart'),
  lua: () => import('@shikijs/langs/lua'),
  latex: () => import('@shikijs/langs/latex'),
  mermaid: () => import('@shikijs/langs/mermaid'),
};

interface ShikiTokenResult {
  tokens: Array<Array<{ content: string; color?: string; offset: number }>>;
  fg: string;
}

interface ShikiHighlighter {
  getLoadedLanguages(): string[];
  loadLanguage(lang: unknown): Promise<void>;
  codeToTokens(code: string, options: { lang: string; theme: string }): ShikiTokenResult;
  dispose(): void;
}

const state = {
  highlighterPromise: null as Promise<ShikiHighlighter> | null,
  highlighter: null as ShikiHighlighter | null,
};

export function isHighlightable(lang: string): boolean {
  return HIGHLIGHTABLE_LANGUAGES.has(lang);
}

async function ensureHighlighter(): Promise<ShikiHighlighter> {
  if (!state.highlighterPromise) {
    state.highlighterPromise = (async (): Promise<ShikiHighlighter> => {
      const { createHighlighterCore } = await import('shiki/core');
      const { createJavaScriptRegexEngine } = await import('shiki/engine/javascript');

      const hl: ShikiHighlighter = await createHighlighterCore({
        themes: [
          import('@shikijs/themes/one-light'),
          import('@shikijs/themes/vitesse-dark'),
        ],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      }) as ShikiHighlighter;
      state.highlighter = hl;
      return hl;
    })();
  }
  return state.highlighterPromise;
}

async function ensureLanguage(highlighter: ShikiHighlighter, lang: string): Promise<void> {
  const loaded: string[] = highlighter.getLoadedLanguages();
  if (loaded.includes(lang)) return;

  const importer = LANG_IMPORTS[lang];
  if (!importer) return;

  await highlighter.loadLanguage(await importer());
}

function mapTokens(result: ShikiTokenResult): ThemeTokens {
  return {
    tokens: result.tokens.map((line) =>
      line.map((token): HighlightToken => ({
        content: token.content,
        color: token.color ?? result.fg,
        offset: token.offset,
      }))
    ),
    fg: result.fg,
  };
}

export async function tokenizeCode(code: string, lang: string): Promise<DualThemeTokens | null> {
  if (!isHighlightable(lang)) return null;

  try {
    const highlighter = await ensureHighlighter();
    await ensureLanguage(highlighter, lang);

    const lightResult: ShikiTokenResult = highlighter.codeToTokens(code, {
      lang,
      theme: SHIKI_LIGHT_THEME,
    });
    const darkResult: ShikiTokenResult = highlighter.codeToTokens(code, {
      lang,
      theme: SHIKI_DARK_THEME,
    });

    return {
      light: mapTokens(lightResult),
      dark: mapTokens(darkResult),
    };
  } catch {
    state.highlighterPromise = null;
    state.highlighter = null;
    return null;
  }
}

export function disposeHighlighter(): void {
  if (state.highlighter) {
    state.highlighter.dispose();
    state.highlighter = null;
  }
  state.highlighterPromise = null;
}
