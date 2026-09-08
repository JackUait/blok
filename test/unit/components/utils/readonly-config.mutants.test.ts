import { describe, it, expect } from 'vitest';

import { normalizeReadOnlyConfig } from '../../../../src/components/utils/readonly-config';
import type { ReadOnlyModeConfig } from '../../../../types';

/** null is typeof "object" and the wire produces it; the signature does not. */
const offSpecNull = null as unknown as ReadOnlyModeConfig | undefined;

describe('normalizeReadOnlyConfig mutants', () => {
  it('reads the boolean forms', () => {
    expect(normalizeReadOnlyConfig(true)).toStrictEqual({ enabled: true, hideControls: false });
    expect(normalizeReadOnlyConfig(false)).toStrictEqual({ enabled: false, hideControls: false });
    expect(normalizeReadOnlyConfig(undefined)).toStrictEqual({ enabled: false, hideControls: false });
  });

  it('treats any object form as enabled, carrying its hideControls', () => {
    expect(normalizeReadOnlyConfig({ hideControls: true })).toStrictEqual({ enabled: true, hideControls: true });
    expect(normalizeReadOnlyConfig({})).toStrictEqual({ enabled: true, hideControls: false });
  });

  it('reads null as no config rather than dereferencing it', () => {
    expect(normalizeReadOnlyConfig(offSpecNull)).toStrictEqual({ enabled: false, hideControls: false });
  });
});
