/**
 * Basic syntax highlighting for code blocks
 * This is a simple implementation that replaces common patterns using placeholders
 * to avoid matching inside HTML tags created during highlighting
 */

export const highlightCode = (code: string): string => {
  // Store strings with placeholders
  const strings: string[] = [];
  const comments: string[] = [];

  const withStringsExtracted = code
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Extract strings and replace with placeholders
    .replace(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g, (_match, quote, content) => {
      const placeholder = `__STRING_${strings.length}__`;
      strings.push(`<span class="token-string">${quote}${content}${quote}</span>`);
      return placeholder;
    });

  // Extract comments and replace with placeholders
  const withCommentsExtracted = withStringsExtracted
    .replace(/(\/\/.*)/g, (match) => {
      const placeholder = `__COMMENT_${comments.length}__`;
      comments.push(`<span class="token-comment">${match}</span>`);
      return placeholder;
    });

  // Now apply other transformations (they won't match inside strings/comments)
  const withTokensHighlighted = withCommentsExtracted
    // Keywords
    .replace(
      /\b(import|from|const|let|var|function|class|new|return|if|else|async|await|export|default|interface|type|extends)\b/g,
      '<span class="token-keyword">$1</span>'
    )
    // Numbers
    .replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>')
    // Functions
    .replace(/\b([a-zA-Z_]\w*)\s*\(/g, '<span class="token-function">$1</span>(');

  // Restore comments first, then strings
  const withCommentsRestored = comments.reduce(
    (result, replacement, i) => result.replace(`__COMMENT_${i}__`, replacement),
    withTokensHighlighted
  );

  const withStringsRestored = strings.reduce(
    (result, replacement, i) => result.replace(`__STRING_${i}__`, replacement),
    withCommentsRestored
  );

  return withStringsRestored;
};
