import { describe, it, expect } from 'vitest';
import { Equation, defaultInlineTools } from '../../../src/tools/index';
import { allTools, Equation as FullEquation } from '../../../src/full';
import { EquationInlineTool } from '../../../src/components/inline-tools/inline-tool-equation';

describe('Equation inline tool registration', () => {
  it('re-exports the EquationInlineTool as Equation from the tools entry', () => {
    expect(Equation).toBe(EquationInlineTool);
  });

  it('includes equation in defaultInlineTools so it shows by default', () => {
    expect(defaultInlineTools).toHaveProperty('equation');
  });

  it('re-exports Equation from the full bundle', () => {
    expect(FullEquation).toBe(EquationInlineTool);
  });

  it('wires equation (and inlineCode) into the full bundle allTools', () => {
    // The batteries-included full bundle (powering /dist/full.mjs) must register
    // every default inline tool, or consumers using `allTools` silently lose the
    // inline equation + code tools.
    expect(allTools).toHaveProperty('equation');
    expect(allTools).toHaveProperty('inlineCode');
  });
});
