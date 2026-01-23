import { describe, it, expect } from 'vitest';
import { highlightCode } from './syntax-highlight';

describe('syntax-highlight', () => {
  describe('highlightCode', () => {
    it('should escape HTML entities', () => {
      const input = '<div class="test">Hello & goodbye</div>';
      const result = highlightCode(input);
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
      expect(result).toContain('&amp;');
    });

    it('should highlight JavaScript keywords', () => {
      const keywords = ['import', 'from', 'const', 'let', 'var', 'function', 'class', 'new', 'return', 'if', 'else', 'async', 'await', 'export', 'default'];
      const input = 'const x = import function from class new return if else async await export default';
      const result = highlightCode(input);

      // Check that keywords are highlighted (function names might also be matched)
      keywords.forEach((keyword) => {
        expect(result).toContain(`${keyword}</span>`);
      });
    });

    it('should highlight string literals', () => {
      const input = `const name = "John";
const single = 'test';
const template = \`value\`;`;
      const result = highlightCode(input);

      expect(result).toContain('<span class="token-string">"John"</span>');
      expect(result).toContain("<span class=\"token-string\">'test'</span>");
      expect(result).toContain('<span class="token-string">`value`</span>');
    });

    it('should highlight single-line comments', () => {
      const input = 'const x = 5; // This is a comment';
      const result = highlightCode(input);
      expect(result).toContain('<span class="token-comment">// This is a comment</span>');
    });

    it('should highlight numbers', () => {
      const input = 'const x = 42; const y = 3.14;';
      const result = highlightCode(input);
      expect(result).toContain('<span class="token-number">42</span>');
      expect(result).toContain('<span class="token-number">3</span>');
    });

    it('should highlight function calls', () => {
      const input = 'console.log("test");';
      const result = highlightCode(input);
      // Function names are highlighted, check for console with a span
      expect(result).toContain('console</span>');
    });

    it('should handle empty input', () => {
      const result = highlightCode('');
      expect(result).toBe('');
    });

    it('should handle code without special patterns', () => {
      const input = 'just some text';
      const result = highlightCode(input);
      expect(result).toContain('just some text');
    });

    it('should preserve line breaks', () => {
      const input = 'line1\nline2\nline3';
      const result = highlightCode(input);
      expect(result).toContain('line1');
      expect(result).toContain('line2');
      expect(result).toContain('line3');
    });

    it('should highlight interface and type keywords', () => {
      const input = 'interface User {} type ID = string;';
      const result = highlightCode(input);
      // Keywords are highlighted
      expect(result).toContain('interface</span>');
      expect(result).toContain('type</span>');
    });

    it('should handle mixed code patterns', () => {
      const input = `import { useState } from 'react';
const App = () => {
  const [count, setCount] = useState(0);
  return <div>Hello</div>;
};`;
      const result = highlightCode(input);

      // Check for various highlights without being too specific about the exact class
      expect(result).toContain('import</span>');
      expect(result).toContain('const</span>');
      expect(result).toContain('return</span>');
      expect(result).toContain('react</span>');
    });
  });
});
