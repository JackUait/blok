import { describe, it, expect } from 'vitest';
import { BODY_PLACEHOLDER_STYLES } from '../../../../src/tools/toggle/constants';

describe('BODY_PLACEHOLDER_STYLES', () => {
  it('does not contain text-sm (placeholder should match paragraph base font size)', () => {
    expect(BODY_PLACEHOLDER_STYLES).not.toContain('text-sm');
  });

  it('contains leading-[1.6em] to match paragraph line-height', () => {
    expect(BODY_PLACEHOLDER_STYLES).toContain('leading-[1.6em]');
  });

  it('uses pt-[calc(0.5em+5px)] to match block wrapper top padding + paragraph margins/padding', () => {
    expect(BODY_PLACEHOLDER_STYLES).toContain('pt-[calc(0.5em+5px)]');
  });

  it('uses pb-[4px] to match paragraph bottom padding + margin', () => {
    expect(BODY_PLACEHOLDER_STYLES).toContain('pb-[4px]');
  });

  it('does not contain py-1 (would cause layout shift vs paragraph block)', () => {
    expect(BODY_PLACEHOLDER_STYLES).not.toContain('py-1');
  });

  it('does not contain py-[3px] (insufficient — missing block wrapper top padding)', () => {
    expect(BODY_PLACEHOLDER_STYLES).not.toContain('py-[3px]');
  });
});
