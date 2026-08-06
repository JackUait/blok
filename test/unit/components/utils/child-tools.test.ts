import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getChildToolRestrictions,
  isChildToolAllowed,
  resolveChildTool,
  restrictedChildToolNames,
} from '../../../../src/components/utils/child-tools';
import type { ChildToolRestrictions } from '../../../../types/tools';
import type { Block } from '../../../../src/components/block';

/**
 * A container block whose tool declares (or does not declare) child restrictions.
 * @param childTools - the restrictions the container's tool declares
 * @param name - the container tool's name
 */
const containerBlock = (childTools?: ChildToolRestrictions, name = 'segments'): Block =>
  ({
    id: `${name}-1`,
    name,
    tool: { name,
      childTools },
  } as unknown as Block);

describe('child-tool restrictions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getChildToolRestrictions', () => {
    it('reads the declaration off the container tool', () => {
      expect(getChildToolRestrictions(containerBlock({ allow: ['segment-item'] })))
        .toEqual({ allow: ['segment-item'] });
    });

    it('treats root (no parent) as unrestricted', () => {
      expect(getChildToolRestrictions(null)).toBeUndefined();
      expect(getChildToolRestrictions(undefined)).toBeUndefined();
    });

    it('treats a container that declares nothing as unrestricted', () => {
      expect(getChildToolRestrictions(containerBlock())).toBeUndefined();
    });

    it('treats empty lists as no restriction', () => {
      // A tool computing its lists at runtime must not be able to lock its own
      // container down by handing back an empty array.
      expect(getChildToolRestrictions(containerBlock({ allow: [],
        deny: [] }))).toBeUndefined();
    });
  });

  describe('isChildToolAllowed', () => {
    it('allows anything under an unrestricted parent', () => {
      expect(isChildToolAllowed(containerBlock(), 'header')).toBe(true);
      expect(isChildToolAllowed(null, 'header')).toBe(true);
    });

    it('allows only the listed tools when an allowlist is declared', () => {
      const parent = containerBlock({ allow: ['segment-item'] });

      expect(isChildToolAllowed(parent, 'segment-item')).toBe(true);
      expect(isChildToolAllowed(parent, 'paragraph')).toBe(false);
    });

    it('rejects the listed tools when a denylist is declared', () => {
      const parent = containerBlock({ deny: ['table'] });

      expect(isChildToolAllowed(parent, 'table')).toBe(false);
      expect(isChildToolAllowed(parent, 'paragraph')).toBe(true);
    });

    it('lets deny win over allow for a tool named in both', () => {
      const parent = containerBlock({ allow: ['paragraph', 'table'],
        deny: ['table'] });

      expect(isChildToolAllowed(parent, 'table')).toBe(false);
      expect(isChildToolAllowed(parent, 'paragraph')).toBe(true);
    });
  });

  describe('resolveChildTool', () => {
    it('keeps a permitted tool', () => {
      expect(resolveChildTool(containerBlock({ allow: ['segment-item'] }), 'segment-item', 'paragraph'))
        .toBe('segment-item');
    });

    it('demotes a disallowed tool to the first allowed one', () => {
      // This is what makes "Enter at the end of a segment" produce another
      // segment rather than a stray paragraph the container has to filter out.
      expect(resolveChildTool(containerBlock({ allow: ['segment-item', 'segment-note'] }), 'header', 'paragraph'))
        .toBe('segment-item');
    });

    it('falls back to the default block when only a denylist is declared', () => {
      expect(resolveChildTool(containerBlock({ deny: ['header'] }), 'header', 'paragraph'))
        .toBe('paragraph');
    });

    it('leaves inserts under an unrestricted parent untouched', () => {
      expect(resolveChildTool(containerBlock(), 'header', 'paragraph')).toBe('header');
      expect(resolveChildTool(null, 'header', 'paragraph')).toBe('header');
    });
  });

  describe('restrictedChildToolNames', () => {
    it('names every candidate the declaration does not permit', () => {
      expect(restrictedChildToolNames({ allow: ['segment-item'] }, ['paragraph', 'header', 'segment-item']))
        .toEqual(['paragraph', 'header']);
    });

    it('names nothing when nothing is declared', () => {
      // Takes the declaration, not a Block: the toolbox only ever holds tool
      // ADAPTERS (api.tools.getBlockTools()), never Block instances.
      expect(restrictedChildToolNames(undefined, ['paragraph', 'header'])).toEqual([]);
    });
  });
});
