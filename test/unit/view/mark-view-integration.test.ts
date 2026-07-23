import { describe, it, expect } from 'vitest';

import { blocksToHtml } from '../../../src/view/blocks-to-html';
import { composeBaseSanitizeConfig } from '../../../src/shared/sanitize-schema';
import { markSanitizerConfig } from '../../../src/components/marks/mark-engine';
import { INLINE_TEXT_SANITIZE } from '../../../src/components/shared/inline-content-sanitize';
import type { SanitizerConfig } from '../../../types';
import type { MarkSpec } from '../../../types/api/marks';
import type { BlokViewSchema } from '../../../src/shared/sanitize-schema';

/**
 * Full BlokView chain: a React-authored `mark` inline tool's static sanitize
 * (= markSanitizerConfig(spec), see packages/react createReactInlineTool)
 * flows through composeBaseSanitizeConfig into the view schema's baseSanitize,
 * then blocksToHtml renders a paragraph carrying that markup. Pre-fix this
 * threw TypeError in createElementFacade (facade lacked classList).
 */
describe('BlokView renders MarkSpec inline tools end-to-end', () => {
  const schemaWith = (markRule: SanitizerConfig): BlokViewSchema => ({
    baseSanitize: composeBaseSanitizeConfig([INLINE_TEXT_SANITIZE, markRule]),
    tools: {},
  });

  it('keeps a declared class-based mark and strips strays', () => {
    const classSpec: MarkSpec = { tag: 'span', className: 'hl-description' };
    const html = blocksToHtml(
      { blocks: [{ type: 'paragraph', data: { text: '<span class="hl-description sneaky">hi</span>' } }] },
      { schema: schemaWith(markSanitizerConfig(classSpec)) }
    );

    expect(html).toContain('class="hl-description"');
    expect(html).not.toContain('sneaky');
    expect(html).toContain('hi');
  });

  it('keeps a declared style-based mark (tag-only, no classes) and strips stray classes', () => {
    const colorSpec: MarkSpec<string> = {
      tag: 'mark',
      style: { color: (value: string): string => value },
    };
    const html = blocksToHtml(
      { blocks: [{ type: 'paragraph', data: { text: '<mark class="stray" style="color: red">warn</mark>' } }] },
      { schema: schemaWith(markSanitizerConfig(colorSpec)) }
    );

    expect(html).toContain('color: red');
    expect(html).not.toContain('stray');
    expect(html).toContain('warn');
  });
});
