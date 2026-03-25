// src/tools/callout/callout-keyboard.ts

import type { API } from '../../../types';

interface FirstChildBackspaceContext {
  api: API;
  calloutBlockId: string | undefined;
  firstChildBlockId: string;
  event: KeyboardEvent;
}

/**
 * Stub — real implementation in Task 4.
 */
export async function handleCalloutFirstChildBackspace(_ctx: FirstChildBackspaceContext): Promise<void> {
  // Will be implemented in Task 4
}
