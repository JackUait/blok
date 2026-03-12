import { describe, it, expect, vi, afterEach } from 'vitest';
import { WidthManager } from '../../../../src/components/modules/widthManager';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokConfig } from '../../../../types';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';

// Helper to create a minimal Blok module context
function createWidthManager(config: Partial<BlokConfig> = {}): {
  manager: WidthManager;
  wrapper: HTMLElement;
} {
  const wrapper = document.createElement('div');
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const manager = new WidthManager({
    config: { defaultWidth: 'narrow', ...config } as BlokConfig,
    eventsDispatcher,
  });

  // Wire state (simulate Core.configureModules)
  manager.state = {
    UI: { nodes: { wrapper } },
  } as unknown as BlokModules;

  return { manager, wrapper };
}

describe('WidthManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('prepare()', () => {
    it('should set --blok-content-width to narrowWidth (default 650px) when defaultWidth is narrow', () => {
      const { manager, wrapper } = createWidthManager({ defaultWidth: 'narrow' });
      manager.prepare();
      expect(wrapper.style.getPropertyValue('--blok-content-width')).toBe('650px');
    });

    it('should use custom narrowWidth when provided', () => {
      const { manager, wrapper } = createWidthManager({ defaultWidth: 'narrow', narrowWidth: '800px' });
      manager.prepare();
      expect(wrapper.style.getPropertyValue('--blok-content-width')).toBe('800px');
    });

    it('should set --blok-content-width to none when defaultWidth is full', () => {
      const { manager, wrapper } = createWidthManager({ defaultWidth: 'full' });
      manager.prepare();
      expect(wrapper.style.getPropertyValue('--blok-content-width')).toBe('none');
    });

    it('should use custom fullWidth when provided', () => {
      const { manager, wrapper } = createWidthManager({ defaultWidth: 'full', fullWidth: '1200px' });
      manager.prepare();
      expect(wrapper.style.getPropertyValue('--blok-content-width')).toBe('1200px');
    });

    it('should default to narrow mode when defaultWidth is not specified', () => {
      const { manager, wrapper } = createWidthManager({});
      manager.prepare();
      expect(wrapper.style.getPropertyValue('--blok-content-width')).toBe('650px');
    });
  });

  describe('setWidth()', () => {
    it('should update --blok-content-width when switching to full', () => {
      const { manager, wrapper } = createWidthManager({ defaultWidth: 'narrow' });
      manager.prepare();
      manager.setWidth('full');
      expect(wrapper.style.getPropertyValue('--blok-content-width')).toBe('none');
    });

    it('should update --blok-content-width when switching to narrow', () => {
      const { manager, wrapper } = createWidthManager({ defaultWidth: 'full' });
      manager.prepare();
      manager.setWidth('narrow');
      expect(wrapper.style.getPropertyValue('--blok-content-width')).toBe('650px');
    });

    it('should call onWidthChange callback with mode and value', () => {
      const onWidthChange = vi.fn();
      const { manager } = createWidthManager({ onWidthChange });
      manager.prepare();
      manager.setWidth('full');
      expect(onWidthChange).toHaveBeenCalledWith('full', 'none');
    });

    it('should not call onWidthChange when setting the same mode', () => {
      const onWidthChange = vi.fn();
      const { manager } = createWidthManager({ defaultWidth: 'narrow', onWidthChange });
      manager.prepare();
      onWidthChange.mockClear();
      manager.setWidth('narrow');
      expect(onWidthChange).not.toHaveBeenCalled();
    });
  });

  describe('getWidth()', () => {
    it('should return the current mode', () => {
      const { manager } = createWidthManager({ defaultWidth: 'narrow' });
      manager.prepare();
      expect(manager.getWidth()).toBe('narrow');
    });

    it('should reflect mode after setWidth()', () => {
      const { manager } = createWidthManager({ defaultWidth: 'narrow' });
      manager.prepare();
      manager.setWidth('full');
      expect(manager.getWidth()).toBe('full');
    });
  });

  describe('toggle()', () => {
    it('should switch from narrow to full', () => {
      const { manager } = createWidthManager({ defaultWidth: 'narrow' });
      manager.prepare();
      manager.toggle();
      expect(manager.getWidth()).toBe('full');
    });

    it('should switch from full to narrow', () => {
      const { manager } = createWidthManager({ defaultWidth: 'full' });
      manager.prepare();
      manager.toggle();
      expect(manager.getWidth()).toBe('narrow');
    });
  });
});
