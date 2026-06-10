/**
 * Type declarations for parse-metadata.mjs.
 */

export interface ParsedMetadata {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  domain?: string;
}

export function parseMetadata(html: string, pageUrl: string): ParsedMetadata;
