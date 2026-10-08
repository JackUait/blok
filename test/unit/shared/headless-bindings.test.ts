import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { INLINE_TOOL_ORDER as legacyInlineToolOrder } from '../../../src/components/constants/inline-tool-order';
import { isObject as utilsIsObject } from '../../../src/components/utils';
import * as legacyPageColors from '../../../src/components/utils/default-page-colors';
import { isObject as legacyIsObject } from '../../../src/components/utils/type-guards';
import * as sharedPageColors from '../../../src/shared/default-page-colors';
import { INLINE_TOOL_ORDER } from '../../../src/shared/inline-tool-order';
import { composeBaseSanitizeConfig } from '../../../src/shared/sanitize-composition';
import { composeBaseSanitizeConfig as legacyComposeBaseSanitizeConfig } from '../../../src/shared/sanitize-schema';
import { isObject } from '../../../src/shared/type-guards';
import { composeBaseSanitizeConfig as viewComposeBaseSanitizeConfig } from '../../../src/view/index';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('headless extraction compatibility bindings', () => {
  it('keeps the legacy inline order array binding', () => {
    expect(legacyInlineToolOrder).toBe(INLINE_TOOL_ORDER);
  });

  it('keeps all four legacy page color function bindings', () => {
    expect(legacyPageColors.isDefaultWhiteBackground).toBe(sharedPageColors.isDefaultWhiteBackground);
    expect(legacyPageColors.isDefaultDarkBackground).toBe(sharedPageColors.isDefaultDarkBackground);
    expect(legacyPageColors.isInvisibleBackground).toBe(sharedPageColors.isInvisibleBackground);
    expect(legacyPageColors.isNearBlackText).toBe(sharedPageColors.isNearBlackText);
  });

  it('keeps isObject through its legacy module and utils barrel', () => {
    expect(legacyIsObject).toBe(isObject);
    expect(utilsIsObject).toBe(isObject);
  });

  it('keeps sanitizer composition through sanitize-schema and view', () => {
    expect(legacyComposeBaseSanitizeConfig).toBe(composeBaseSanitizeConfig);
    expect(viewComposeBaseSanitizeConfig).toBe(composeBaseSanitizeConfig);
  });
});
