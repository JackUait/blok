import { describe, it, expect } from 'vitest';
import * as ReactApi from '../../../src/react/index';

describe('@jackuait/blok/react exports', () => {
  it('exports useBlok, BlokContent, and BlokEditor', () => {
    expect(typeof ReactApi.useBlok).toBe('function');
    expect(ReactApi.BlokContent).toBeDefined();
    expect(ReactApi.BlokEditor).toBeDefined();
  });
});
