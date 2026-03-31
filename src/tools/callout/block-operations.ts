// src/tools/callout/block-operations.ts

import type { CalloutData } from './types';

interface SaveCalloutOptions {
  emoji: string;
  textColor: string | null;
  backgroundColor: string | null;
}

export function saveCallout(options: SaveCalloutOptions): CalloutData {
  return {
    emoji: options.emoji,
    textColor: options.textColor,
    backgroundColor: options.backgroundColor,
  };
}
