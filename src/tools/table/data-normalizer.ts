import type { TableData } from './types';

/**
 * Check if data is in legacy editor-js table format
 * (single block with content: string[][])
 */
export const isLegacyTableData = (data: unknown): boolean => {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  return Array.isArray(obj.content) &&
    obj.content.length > 0 &&
    Array.isArray(obj.content[0]);
};

/**
 * Normalize table data from any format to TableData
 */
export const normalizeTableData = (
  data: Record<string, unknown>,
  defaults?: { withHeadings?: boolean; stretched?: boolean }
): TableData => {
  return {
    withHeadings: (data.withHeadings as boolean) ?? defaults?.withHeadings ?? false,
    withHeadingColumn: (data.withHeadingColumn as boolean) ?? false,
    stretched: (data.stretched as boolean) ?? defaults?.stretched ?? false,
    content: Array.isArray(data.content) ? data.content as string[][] : [],
  };
};
