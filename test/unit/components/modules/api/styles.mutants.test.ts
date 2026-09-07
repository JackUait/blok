import { describe, it, expect } from 'vitest';

import { StylesAPI } from '../../../../../src/components/modules/api/styles';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';

const api = (): StylesAPI => {
  const moduleConfig: ModuleConfig = {
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  return new StylesAPI(moduleConfig);
};

describe('StylesAPI mutants', () => {
  it('hands tool authors the exact class names main.css defines', () => {
    expect(api().classes).toStrictEqual({
      block: 'blok-block',
      inlineToolButton: 'blok-inline-tool-button',
      inlineToolButtonActive: 'blok-inline-tool-button--active',
      input: 'blok-input',
      loader: 'blok-loader',
      button: 'blok-button',
      settingsButton: 'blok-settings-button',
      settingsButtonActive: 'blok-settings-button--active',
      settingsButtonFocused: 'blok-settings-button--focused',
      settingsButtonFocusedAnimated: 'blok-settings-button--focused-animated',
    });
  });

  it('gives every entry a single class, safe for classList.add', () => {
    for (const [key, className] of Object.entries(api().classes)) {
      expect(className, key).not.toBe('');
      expect(className, key).not.toMatch(/\s/);
      expect(className, key).toMatch(/^blok-/);
    }
  });

  it('keeps each state a modifier of its own base class', () => {
    const { classes } = api();

    expect(classes.inlineToolButtonActive.startsWith(`${classes.inlineToolButton}--`)).toBe(true);
    expect(classes.settingsButtonActive.startsWith(`${classes.settingsButton}--`)).toBe(true);
    expect(classes.settingsButtonFocused.startsWith(`${classes.settingsButton}--`)).toBe(true);
    expect(classes.settingsButtonFocusedAnimated.startsWith(`${classes.settingsButton}--`)).toBe(true);
  });

  it('gives every entry a distinct class name', () => {
    const values = Object.values(api().classes);

    expect(new Set(values).size).toBe(values.length);
  });
});
