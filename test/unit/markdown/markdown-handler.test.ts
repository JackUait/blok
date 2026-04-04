import { describe, it, expect } from 'vitest';
import { hasMarkdownSignals } from '../../../src/markdown/markdown-handler';

describe('hasMarkdownSignals', () => {
  it('detects heading syntax', () => {
    expect(hasMarkdownSignals('# Hello World')).toBe(true);
    expect(hasMarkdownSignals('## Subheading')).toBe(true);
    expect(hasMarkdownSignals('### Third level')).toBe(true);
  });

  it('detects fenced code blocks', () => {
    expect(hasMarkdownSignals('```js\nconsole.log("hi")\n```')).toBe(true);
  });

  it('detects GFM table separators', () => {
    expect(hasMarkdownSignals('| A | B |\n| --- | --- |')).toBe(true);
  });

  it('detects task list items', () => {
    expect(hasMarkdownSignals('- [ ] Todo item')).toBe(true);
    expect(hasMarkdownSignals('- [x] Done item')).toBe(true);
  });

  it('detects markdown links', () => {
    expect(hasMarkdownSignals('Check out [this link](https://example.com)')).toBe(true);
  });

  it('detects bold syntax', () => {
    expect(hasMarkdownSignals('This is **bold** text')).toBe(true);
  });

  it('detects image syntax', () => {
    expect(hasMarkdownSignals('![alt text](https://img.com/pic.png)')).toBe(true);
  });

  it('rejects plain text without markdown signals', () => {
    expect(hasMarkdownSignals('Hello world')).toBe(false);
    expect(hasMarkdownSignals('Just some regular text here.')).toBe(false);
    expect(hasMarkdownSignals('Price is $100 or #1 best seller')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(hasMarkdownSignals('')).toBe(false);
  });

  it('rejects # not followed by space', () => {
    expect(hasMarkdownSignals('#hashtag')).toBe(false);
  });
});
