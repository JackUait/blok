import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import * as VueApi from '../../../packages/vue/src/index';
import { BlokContent } from '../../../packages/vue/src/index';

describe('@blok/vue exports', () => {
  it('exports BlokEditor, BlokContent, useBlok, provideBlok, useBlokDefaults, BLOK_DEFAULT_CONFIG', () => {
    expect(VueApi.BlokEditor).toBeDefined();
    expect(VueApi.BlokContent).toBeDefined();
    expect(typeof VueApi.useBlok).toBe('function');
    expect(typeof VueApi.provideBlok).toBe('function');
    expect(typeof VueApi.useBlokDefaults).toBe('function');
    expect(VueApi.BLOK_DEFAULT_CONFIG).toBeDefined();
  });

  it('mounts under jsdom via @vue/test-utils (harness smoke)', () => {
    // BlokContent with no editor renders an empty container div without
    // touching the core — proves mount() works in the existing `unit` project.
    const wrapper = mount(BlokContent, { props: { editor: null } });

    expect(wrapper.find('div').exists()).toBe(true);
    wrapper.unmount();
  });
});
