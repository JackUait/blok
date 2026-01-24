export interface BlokEditor {
  save: () => Promise<unknown>;
  render: (data: unknown) => Promise<void>;
  clear: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  focus: (atEnd?: boolean) => boolean;
  destroy: () => void;
  blocks: unknown;
  caret: unknown;
  saver: unknown;
  toolbar: unknown;
  inlineToolbar: unknown;
  events: unknown;
}

/**
 * Editor instance type for API demo components.
 * This matches the /dist/full.mjs module that's loaded dynamically in demos.
 * Note: This is a duplicate of the type in vite-env.d.ts for import purposes.
 * The actual module is loaded via dynamic import() and resolved by Vite's externalDistPlugin.
 */
export interface BlokEditorInstance {
  destroy?(): void;
  clear(): Promise<void>;
  render(data: { blocks: unknown[] }): Promise<void>;
  blocks: {
    getBlocksCount(): number;
    clear(): Promise<void>;
    move(toIndex: number, fromIndex?: number): void;
    insert(): unknown;
    insert(type: string, data: unknown, config: unknown, index: number): unknown;
    render(data: { blocks: unknown[] }): Promise<void>;
  };
  insert(toIndex?: number): unknown;
  insert(type?: string, data?: unknown, config?: unknown, index?: number, needToFocus?: boolean, replace?: boolean, id?: string): unknown;
  [key: string]: unknown;
}

/**
 * Module type for the /dist/full.mjs dynamic import.
 * Note: This is a duplicate of the type in vite-env.d.ts for import purposes.
 * The actual module is loaded via dynamic import() and resolved by Vite's externalDistPlugin.
 */
export interface BlokModule {
  Blok: new (config: unknown) => BlokEditorInstance;
  Header: unknown;
  Paragraph: unknown;
  List: unknown;
  Bold: unknown;
  Italic: unknown;
  Link: unknown;
}

export interface BlokModuleOld {
  Blok: new (config: unknown) => BlokEditor;
  Header: unknown;
  Paragraph: unknown;
  List: unknown;
  Bold: unknown;
  Italic: unknown;
  Link: unknown;
}

// Note: Module declaration for /dist/full.mjs is in vite-env.d.ts
// This import is resolved at runtime by Vite's externalDistPlugin
