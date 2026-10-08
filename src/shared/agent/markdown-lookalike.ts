const MARKDOWN = /\*\*[^*\n]+\*\*|__[^_\n]+__|^#{1,6}\s|^\s*[-*+]\s+\S|^\s*\d+\.\s+\S|\[[^\]\n]+\]\([^)\n]+\)|`[^`\n]+`/m;

export const looksLikeMarkdown = (text: string): boolean => MARKDOWN.test(text);
