/// <reference types="vite/client" />
/// <reference types="@testing-library/jest-dom/vitest" />

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Global search index cache
declare global {
  // eslint-disable-next-line no-var
  var __blokSearchIndex: SearchIndexItem[] | undefined;
}

import type { SearchIndexItem } from '@/types/search';

// Declare the /dist/ module that is resolved by Vite's externalDistPlugin
declare module '/dist/full.mjs' {
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

  export const Blok: new (config: unknown) => BlokEditorInstance;
  export const Header: unknown;
  export const Paragraph: unknown;
  export const List: unknown;
  export const Bold: unknown;
  export const Italic: unknown;
  export const Link: unknown;
}

export {};