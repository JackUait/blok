import type mermaidType from 'mermaid';

const state = {
  mermaidPromise: null as Promise<typeof mermaidType> | null,
  initialized: false,
};

async function loadMermaid(): Promise<typeof mermaidType> {
  if (!state.mermaidPromise) {
    state.mermaidPromise = import('mermaid').then((mod) => mod.default);
  }

  const mermaid = await state.mermaidPromise;

  if (!state.initialized) {
    state.initialized = true;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  }

  return mermaid;
}

/**
 * Render a Mermaid diagram string to SVG. Lazy-loads Mermaid on first call.
 */
export async function renderMermaid(code: string): Promise<string> {
  try {
    const mermaid = await loadMermaid();

    const parseResult = await mermaid.parse(code, { suppressErrors: true });

    if (parseResult === false) {
      return '<span class="text-red-500 text-sm">Invalid Mermaid syntax</span>';
    }

    const id = `mermaid-${crypto.randomUUID()}`;
    const result = await mermaid.render(id, code);

    return result.svg;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return `<span class="text-red-500 text-sm">${message}</span>`;
  }
}
