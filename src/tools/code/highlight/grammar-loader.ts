import type { Highlighter } from './engine';

export interface GrammarEntry {
  requires?: readonly string[];
  /** Loaded first when the loader is asked to; the grammar reads them while it is defined. */
  optional?: readonly string[];
  load: () => Promise<{ define: (hl: Highlighter) => void }>;
}

export type GrammarTable = Record<string, GrammarEntry>;

/**
 * Every grammar Blok ships, keyed by Prism's grammar name. Dependencies come from
 * Prism's components.json. The order matters: each grammar comes after what it
 * requires or patches, which is also the order Prism's own tests load them in.
 */
export const GRAMMARS = {
  markup: { load: () => import('./grammars/markup') },
  // css and javascript patch markup (inline <style>, <script>, style=, on*=) only if it is there already.
  css: { load: () => import('./grammars/css') },
  clike: { load: () => import('./grammars/clike') },
  javascript: { requires: ['clike'], load: () => import('./grammars/javascript') },
  'markup-templating': { requires: ['markup'], load: () => import('./grammars/markup-templating') },
  typescript: { requires: ['javascript'], load: () => import('./grammars/typescript') },
  python: { load: () => import('./grammars/python') },
  java: { requires: ['clike'], load: () => import('./grammars/java') },
  c: { requires: ['clike'], load: () => import('./grammars/c') },
  cpp: { requires: ['c'], load: () => import('./grammars/cpp') },
  csharp: { requires: ['clike'], load: () => import('./grammars/csharp') },
  go: { requires: ['clike'], load: () => import('./grammars/go') },
  rust: { load: () => import('./grammars/rust') },
  ruby: { requires: ['clike'], load: () => import('./grammars/ruby') },
  php: { requires: ['markup-templating'], load: () => import('./grammars/php') },
  swift: { load: () => import('./grammars/swift') },
  kotlin: { requires: ['clike'], load: () => import('./grammars/kotlin') },
  sql: { load: () => import('./grammars/sql') },
  json: { load: () => import('./grammars/json') },
  yaml: { load: () => import('./grammars/yaml') },
  markdown: { requires: ['markup'], optional: ['yaml'], load: () => import('./grammars/markdown') },
  bash: { load: () => import('./grammars/bash') },
  docker: { load: () => import('./grammars/docker') },
  graphql: { optional: ['markdown'], load: () => import('./grammars/graphql') },
  r: { load: () => import('./grammars/r') },
  scala: { requires: ['java'], load: () => import('./grammars/scala') },
  dart: { requires: ['clike'], load: () => import('./grammars/dart') },
  lua: { load: () => import('./grammars/lua') },
  latex: { load: () => import('./grammars/latex') },
  mermaid: { load: () => import('./grammars/mermaid') },
} satisfies GrammarTable;

/**
 * The grammars Prism's main bundle always carried. Blok loads them first, in
 * this order, so HTML, Markdown and PHP always see markup with css and
 * javascript already patched in.
 */
export const BASE_GRAMMARS = ['markup', 'css', 'clike', 'javascript'] as const;

export interface GrammarLoaderOptions {
  /** Defined before anything else, in order. */
  base: readonly string[];
  /** Whether to define a grammar's optional grammars before it. */
  optional: boolean;
}

/**
 * Returns `load(id)`, which defines a grammar, its dependencies and the whole
 * base on `hl`, each exactly once. Concurrent calls share one promise.
 *
 * A failed chunk load is forgotten, so the next call tries again. A `define`
 * that throws is not: running it again would register its hooks twice. An
 * optional grammar that fails to load is skipped, as Prism does.
 */
export const createGrammarLoader = (
  hl: Highlighter,
  options: GrammarLoaderOptions,
  table: GrammarTable = GRAMMARS
): ((id: string) => Promise<void>) => {
  const loading = new Map<string, Promise<void>>();

  const requiredOf = (id: string, entry: GrammarEntry): string[] => {
    const baseIndex = options.base.indexOf(id);
    const base = baseIndex === -1 ? options.base : options.base.slice(0, baseIndex);

    return [...base, ...(entry.requires ?? [])];
  };

  const load = (id: string): Promise<void> => {
    const pending = loading.get(id);

    if (pending) {
      return pending;
    }

    const entry = Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;

    if (!entry) {
      return Promise.reject(new Error(`Unknown grammar "${id}"`));
    }

    const progress = { defining: false };
    const promise = (async (): Promise<void> => {
      for (const dependency of requiredOf(id, entry)) {
        await load(dependency);
      }

      for (const dependency of options.optional ? entry.optional ?? [] : []) {
        await load(dependency).catch(() => undefined);
      }

      const { define } = await entry.load();

      progress.defining = true;
      define(hl);
    })();

    loading.set(id, promise);
    promise.catch(() => {
      if (!progress.defining) {
        loading.delete(id);
      }
    });

    return promise;
  };

  const lastBase = options.base[options.base.length - 1];

  // A base grammar alone is not enough: markup is only complete once css and
  // javascript have patched it.
  return async (id: string): Promise<void> => {
    await load(id);

    if (lastBase !== undefined) {
      await load(lastBase);
    }
  };
};
