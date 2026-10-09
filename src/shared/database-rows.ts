/**
 * How exports read a database's rows. DOM-free: the view, the server and the
 * Markdown serializer share it.
 */

interface RowLike {
  data: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Id of the title property in a database block's data. */
export const titlePropertyIdOf = (databaseData: Record<string, unknown>): string | undefined => {
  const schema = Array.isArray(databaseData.schema) ? databaseData.schema : [];
  const title = schema.find((property): property is Record<string, unknown> => isRecord(property) && property.type === 'title');

  return typeof title?.id === 'string' ? title.id : undefined;
};

/**
 * A row's title: the top-level `title`, else the title property's value
 * (rows written before `title` existed keep it only there).
 */
export const databaseRowTitle = (row: RowLike, titlePropertyId: string | undefined): string => {
  if (typeof row.data.title === 'string') {
    return row.data.title;
  }
  const properties = isRecord(row.data.properties) ? row.data.properties : {};
  const value = titlePropertyId === undefined ? undefined : properties[titlePropertyId];

  return typeof value === 'string' ? value : '';
};

/** The database's manual row order: by fractional `position`, ties kept as they came. */
export const inRowOrder = <T extends RowLike>(rows: T[]): T[] => {
  const positionOf = (row: T): string => (typeof row.data.position === 'string' ? row.data.position : '');

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const pa = positionOf(a.row);
      const pb = positionOf(b.row);

      if (pa !== pb) {
        return pa < pb ? -1 : 1;
      }

      return a.index - b.index;
    })
    .map(({ row }) => row);
};
