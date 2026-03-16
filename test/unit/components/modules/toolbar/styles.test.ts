import { describe, it, expect } from 'vitest';
import { getToolbarStyles } from '../../../../../src/components/modules/toolbar/styles';

describe('Toolbar styles', () => {
  it('toolbar content should use dynamic max-w-blok-content to respond to width mode changes', () => {
    const styles = getToolbarStyles();

    expect(styles.content).toContain('max-w-blok-content');
    expect(styles.content).not.toContain('max-w-content');
  });
});
