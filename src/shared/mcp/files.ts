/** The bytes the files source writes; its version is their SHA-256. */
export const savedFileText = (document: unknown): string => `${JSON.stringify(document, null, 2)}\n`;
