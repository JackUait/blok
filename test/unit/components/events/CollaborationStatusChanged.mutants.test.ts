import { describe, expect, it } from 'vitest';

import { CollaborationStatusChanged } from '../../../../src/components/events/CollaborationStatusChanged';

describe('CollaborationStatusChanged', () => {
  // The string is the public event name peers subscribe to; emptying it breaks
  // every listener silently.
  it('keeps the published event name stable', () => {
    expect(CollaborationStatusChanged).toBe('collaboration:status');
  });
});
