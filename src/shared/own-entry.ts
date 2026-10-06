/**
 * Read a table entry by its own key only. A block typed `constructor` or
 * `toString` would otherwise read an Object.prototype member.
 * @param table - lookup table keyed by block type
 * @param key - the block type
 */
export const ownEntry = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
