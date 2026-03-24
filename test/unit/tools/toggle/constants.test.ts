import { describe, it, expect } from 'vitest';
import { BODY_PLACEHOLDER_STYLES, CONTENT_STYLES, TOGGLE_CHILDREN_STYLES } from '../../../../src/tools/toggle/constants';

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

  it('uses pl-[1.1em] to match Notion toggle children indent', () => {
    expect(BODY_PLACEHOLDER_STYLES).toContain('pl-[1.1em]');
  });
});

describe('CONTENT_STYLES (Notion alignment)', () => {
  it('uses unitless leading-[1.5] to match Notion line-height', () => {
    expect(CONTENT_STYLES).toContain('leading-[1.5]');
  });
});

describe('TOGGLE_CHILDREN_STYLES (Notion alignment)', () => {
  it('uses pl-[1.1em] to match Notion toggle children indent', () => {
    expect(TOGGLE_CHILDREN_STYLES).toContain('pl-[1.1em]');
  });

  it('does not use pl-7 (28px too wide, Notion uses 1.1em)', () => {
    expect(TOGGLE_CHILDREN_STYLES).not.toContain('pl-7');
  });
});
