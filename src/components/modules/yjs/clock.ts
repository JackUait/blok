// Bound once at import, so fake timers that replace the global `Date` later do
// not reach it. y-protocols stamps awareness rows with the same kind of
// binding, and document-store ages those rows against this one.
export const getUnixTime: () => number = Date.now;
