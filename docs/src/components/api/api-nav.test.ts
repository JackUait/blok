// docs/src/components/api/api-nav.test.ts
import { describe, it, expect } from 'vitest';
import { SIDEBAR_GROUPS, MODULE_ORDER, resolveLegacyHash } from './api-nav';
import { API_SECTIONS } from './api-data';

describe('api-nav', () => {
  it('every API section appears in exactly one group', () => {
    const grouped = SIDEBAR_GROUPS.flatMap((g) => g.moduleIds);
    const sectionIds = API_SECTIONS.map((s) => s.id);
    expect([...grouped].sort()).toEqual([...sectionIds].sort());
    expect(new Set(grouped).size).toBe(grouped.length); // no duplicates
  });

  it('MODULE_ORDER is the flat group order', () => {
    expect(MODULE_ORDER[0]).toBe('quick-start');
    expect(MODULE_ORDER).toContain('caret-api');
  });

  it('resolveLegacyHash maps a bare section', () => {
    expect(resolveLegacyHash('caret-api')).toEqual({ moduleId: 'caret-api', anchor: undefined });
  });

  it('resolveLegacyHash maps a config option anchor', () => {
    expect(resolveLegacyHash('config-holder')).toEqual({ moduleId: 'config', anchor: 'config-holder' });
  });

  it('resolveLegacyHash maps a method anchor via longest prefix', () => {
    expect(resolveLegacyHash('caret-api-focus')).toEqual({ moduleId: 'caret-api', anchor: 'caret-api-focus' });
  });

  it('resolveLegacyHash returns null for unknown', () => {
    expect(resolveLegacyHash('totally-unknown')).toBeNull();
  });
});
