import { describe, expect, it } from 'vitest';
import { renderPageIcon } from '../../src/shell/page-icon';

describe('workspace image icons', () => {
  it('renders a private asset as an image without exposing its URL as text', () => {
    const target = document.createElement('span');
    renderPageIcon(target, '/files/workspace-icon.png');
    expect(target.textContent).toBe('');
    expect(target.querySelector('img')?.getAttribute('src')).toBe('/files/workspace-icon.png');
    renderPageIcon(target, '📚');
    expect(target.textContent).toBe('📚');
    expect(target.querySelector('img')).toBeNull();
  });
  it('does not render markup or executable URLs', () => {
    const target = document.createElement('span');
    for (const value of ['javascript:alert(1)', '<img src=x onerror=alert(1)>', 'data:text/html;base64,PHNjcmlwdD4=', 'https://user:secret@example.com/icon.png']) {
      renderPageIcon(target, value);
      expect(target.querySelector('img')).toBeNull();
      expect(target.textContent).toBe(value);
    }
  });
});
