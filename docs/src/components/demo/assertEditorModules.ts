/**
 * The demo page loads BlokEditor and its tools from the parent /dist build at
 * runtime via dynamic import — that build can go stale (e.g. rebuilt before a
 * new export was added) without the import() call itself failing. A stale
 * bundle resolves fine but is missing a named export, so React later throws an
 * uncaught "Element type is invalid" error deep in its render internals.
 * Checking the shape right after import turns that crash into the page's
 * existing "Failed to load" UI, with a message that says why.
 */
export function assertEditorModulesComplete(
  react: Record<string, unknown>,
  tools: Record<string, unknown>,
): void {
  const required = {
    BlokEditor: react.BlokEditor,
    Header: tools.Header,
    Paragraph: tools.Paragraph,
    List: tools.List,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Blok editor bundle is missing expected export(s): ${missing.join(', ')}. ` +
        'The /dist build is likely stale — rebuild with `npm run build`.',
    );
  }
}
