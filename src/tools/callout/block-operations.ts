// src/tools/callout/block-operations.ts

import type { CalloutData, CalloutColor } from './types';
import { stripFakeBackgroundElements } from '../../components/utils';

interface SaveCalloutOptions {
  textElement: HTMLElement;
  emoji: string;
  color: CalloutColor;
}

export function saveCallout(options: SaveCalloutOptions): CalloutData {
  return {
    text: stripFakeBackgroundElements(options.textElement.innerHTML),
    emoji: options.emoji,
    color: options.color,
  };
}
