/// <reference types="vite/client" />

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

export {};