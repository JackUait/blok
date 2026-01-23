import { describe, it, expect } from 'vitest';
import { detectStyleFromPastedContent } from '../../../../src/tools/list/paste-handler';

describe('paste-handler debug', () => {
  it('detects ordered from li with ol parent', () => {
    const ol = document.createElement('ol');
    const li = document.createElement('li');
    li.setAttribute('style', 'list-style-type:decimal');
    li.textContent = 'Test';
    ol.appendChild(li);

    // Check if parent is still there
    console.log('li parentElement:', li.parentElement?.tagName);

    const result = detectStyleFromPastedContent(li, 'unordered');
    console.log('result:', result);
    expect(result).toBe('ordered');
  });

  it('detects ordered from orphaned li with style attribute', () => {
    const li = document.createElement('li');
    li.setAttribute('style', 'list-style-type:decimal');
    li.textContent = 'Test';

    // No parent
    console.log('li parentElement:', li.parentElement);

    const result = detectStyleFromPastedContent(li, 'unordered');
    console.log('result:', result);
    expect(result).toBe('ordered');
  });

  it('detects ordered from li extracted from ol (cloneNode)', () => {
    const ol = document.createElement('ol');
    const li = document.createElement('li');
    li.setAttribute('style', 'list-style-type:decimal');
    li.textContent = 'Test';
    ol.appendChild(li);

    // Clone the li without cloning the parent
    const clonedLi = li.cloneNode(true) as HTMLElement;
    console.log('cloned li parentElement:', clonedLi.parentElement);

    const result = detectStyleFromPastedContent(clonedLi, 'unordered');
    console.log('result:', result);
    expect(result).toBe('ordered');
  });
});
