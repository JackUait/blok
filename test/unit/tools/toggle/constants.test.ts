import { describe, it, expect } from 'vitest';
import { BODY_PLACEHOLDER_STYLES } from '../../../../src/tools/toggle/constants';

describe('BODY_PLACEHOLDER_STYLES', () => {
  it('does not contain text-sm (placeholder should match paragraph base font size)', () => {
    expect(BODY_PLACEHOLDER_STYLES).not.toContain('text-sm');
  });

  it('contains leading-[1.6em] to match paragraph line-height', () => {
    expect(BODY_PLACEHOLDER_STYLES).toContain('leading-[1.6em]');
  });

  it('uses py-[3px] to match blok-block paragraph vertical padding', () => {
    expect(BODY_PLACEHOLDER_STYLES).toContain('py-[3px]');
  });

  it('does not contain py-1 (would cause layout shift vs paragraph block)', () => {
    expect(BODY_PLACEHOLDER_STYLES).not.toContain('py-1');
  });
});
