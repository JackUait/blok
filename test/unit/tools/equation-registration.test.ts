import { describe, it, expect } from 'vitest';
import { Equation, defaultInlineTools } from '../../../src/tools/index';
import { EquationInlineTool } from '../../../src/components/inline-tools/inline-tool-equation';

describe('Equation inline tool registration', () => {
  it('re-exports the EquationInlineTool as Equation from the tools entry', () => {
    expect(Equation).toBe(EquationInlineTool);
  });

  it('includes equation in defaultInlineTools so it shows by default', () => {
    expect(defaultInlineTools).toHaveProperty('equation');
  });
});
