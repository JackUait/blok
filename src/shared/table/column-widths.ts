export const insertedColumnWidth = (existing: number[], initialColWidth: number | undefined): number => (initialColWidth !== undefined
  ? Math.round((initialColWidth / 2) * 100) / 100
  : Math.round((existing.reduce((sum, w) => sum + w, 0) / existing.length / 2) * 100) / 100);
