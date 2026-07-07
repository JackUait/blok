import { describe, it, expect } from 'vitest';
import { ARROW_STYLES, BODY_PLACEHOLDER_STYLES, CONTENT_STYLES, TOGGLE_CHILDREN_STYLES, TOGGLE_WRAPPER_STYLES } from '../../../../src/tools/toggle/constants';

describe('BODY_PLACEHOLDER_STYLES', () => {
  it('does not contain text-sm (placeholder should match paragraph base font size)', () => {
    expect(BODY_PLACEHOLDER_STYLES).not.toContain('text-sm');
  });

  it('contains leading-[1.5] to match Notion body text line-height', () => {
    expect(BODY_PLACEHOLDER_STYLES).toContain('leading-[1.5]');
  });

  it('uses pt-[8px] to match paragraph top padding (7px) + top margin (1px)', () => {
    expect(BODY_PLACEHOLDER_STYLES).toContain('pt-[8px]');
  });

  it('uses pb-[8px] to match paragraph bottom padding (7px) + bottom margin (1px)', () => {
    expect(BODY_PLACEHOLDER_STYLES).toContain('pb-[8px]');
  });

  it('does not contain py-1 (would cause layout shift vs paragraph block)', () => {
    expect(BODY_PLACEHOLDER_STYLES).not.toContain('py-1');
  });

  it('does not contain py-[7px] (missing paragraph margin contribution)', () => {
    expect(BODY_PLACEHOLDER_STYLES).not.toContain('py-[7px]');
  });

  it('uses pl-7 to align body placeholder with toggle list title text start', () => {
    expect(BODY_PLACEHOLDER_STYLES).toContain('pl-7');
  });

  it('does not use pl-[1.1em] (body should align with title, not use Notion indent)', () => {
    expect(BODY_PLACEHOLDER_STYLES).not.toContain('pl-[1.1em]');
  });
});

describe('CONTENT_STYLES (Notion alignment)', () => {
  it('uses unitless leading-[1.5] to match Notion line-height', () => {
    expect(CONTENT_STYLES).toContain('leading-[1.5]');
  });
});

describe('TOGGLE_WRAPPER_STYLES (arrow sits on first line)', () => {
  it('aligns children to the start so the arrow stays on the first line of multi-line titles', () => {
    expect(TOGGLE_WRAPPER_STYLES).toContain('items-start');
  });

  it('does NOT use items-center (would vertically center the arrow across all wrapped lines)', () => {
    expect(TOGGLE_WRAPPER_STYLES).not.toContain('items-center');
  });
});

describe('ARROW_STYLES (fixed-size pill, first-line aligned)', () => {
  it('uses a fixed 28px square (h-7 w-7) so the container height never changes', () => {
    expect(ARROW_STYLES).toContain('h-7');
    expect(ARROW_STYLES).toContain('w-7');
  });

  it('does NOT size the box with em units (would scale the pill with font-size)', () => {
    expect(ARROW_STYLES).not.toContain('h-[1.5em]');
    expect(ARROW_STYLES).not.toContain('h-[1.3em]');
  });

  it('does NOT apply uniform p-[8px] (vertical padding is replaced by the fixed square)', () => {
    expect(ARROW_STYLES).not.toContain('p-[8px]');
  });

  it('offsets the fixed pill so its center lands on the first line (leading-1.5)', () => {
    expect(ARROW_STYLES).toContain('mt-[calc(0.75em_-_14px)]');
  });
});

describe('TOGGLE_CHILDREN_STYLES (title alignment)', () => {
  it('uses pl-7 to align children with toggle list title text start (arrow button width)', () => {
    expect(TOGGLE_CHILDREN_STYLES).toContain('pl-7');
  });

  it('does not use pl-[1.1em] (children should start at same point as title, not Notion indent)', () => {
    expect(TOGGLE_CHILDREN_STYLES).not.toContain('pl-[1.1em]');
  });
});
