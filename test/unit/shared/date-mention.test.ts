import { describe, expect, it } from 'vitest';
import { dateMentionLabel, localDateIso, readDateMention } from '../../../src/shared/date-mention';

describe('inline calendar date labels', () => {
  it('keeps one date while its relative label changes', () => {
    const stored = localDateIso(new Date(2026, 10, 8));

    expect(stored).toBe('2026-11-08');
    expect(dateMentionLabel(stored, new Date(2026, 10, 7), 'fr')).toBe('Demain');
    expect(dateMentionLabel(stored, new Date(2026, 10, 8), 'fr')).toBe('Aujourd’hui');
    expect(dateMentionLabel(stored, new Date(2026, 10, 9), 'fr')).toBe('Hier');
    expect(dateMentionLabel(stored, new Date(2026, 10, 18), 'fr')).toContain('nov. 2026');
  });

  it('rejects nonexistent calendar days', () => {
    expect(readDateMention('2026-02-30')).toBeNull();
    expect(readDateMention('2024-02-29')).not.toBeNull();
  });
});
