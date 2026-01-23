/**
 * Basic syntax highlighting for code blocks
 * This is a simple implementation that replaces common patterns
 */

export const highlightCode = (code: string): string => {
  const html = code
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Keywords
    .replace(
      /\b(import|from|const|let|var|function|class|new|return|if|else|async|await|export|default|interface|type|extends)\b/g,
      '<span class="token-keyword">$1</span>'
    )
    // Strings
    .replace(/(['"`])(.*?)\1/g, '<span class="token-string">$1$2$1</span>')
    // Comments
    .replace(/(\/\/.*)/g, '<span class="token-comment">$1</span>')
    // Numbers
    .replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>')
    // Functions
    .replace(/\b([a-zA-Z_]\w*)\s*\(/g, '<span class="token-function">$1</span>(');

  return html;
};
