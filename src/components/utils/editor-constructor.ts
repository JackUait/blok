import type { Blok } from '../../blok';

declare const VERSION: string | undefined;

/**
 * Tools that open a nested editor read the constructor from here, never import
 * src/blok: that import keeps the whole core in a tools-only consumer bundle.
 * Page-wide so the ESM and CJS copies share it; keyed by version so two Blok
 * versions on one page never swap editors.
 */
export const EDITOR_CONSTRUCTOR = Symbol.for(`blok.editor@${typeof VERSION === 'undefined' ? 'dev' : VERSION}`);

type Scope = Record<symbol, typeof Blok | undefined>;

export const registerEditorConstructor = (editor: typeof Blok): void => {
  (globalThis as unknown as Scope)[EDITOR_CONSTRUCTOR] = editor;
};

export class NoEditorConstructorError extends Error {
  constructor() {
    super('No Blok editor has been constructed on this page');
    this.name = 'NoEditorConstructorError';
  }
}

/** Rejects with NoEditorConstructorError when no editor of this version was constructed on the page. */
export const loadEditorConstructor = async (): Promise<typeof Blok> => {
  const editor = (globalThis as unknown as Scope)[EDITOR_CONSTRUCTOR];

  if (editor === undefined) {
    throw new NoEditorConstructorError();
  }

  return editor;
};
