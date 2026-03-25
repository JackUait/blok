// src/tools/callout/block-operations.ts

import type { CalloutData, CalloutColor } from './types';

interface SaveCalloutOptions {
  emoji: string;
  color: CalloutColor;
}

export function saveCallout(options: SaveCalloutOptions): CalloutData {
  return {
    emoji: options.emoji,
    color: options.color,
  };
}
