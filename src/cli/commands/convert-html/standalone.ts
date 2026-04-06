import * as fs from 'node:fs';
import { JSDOM } from 'jsdom';

// Provide DOM globals for convertHtml and block-builder
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;

async function main(): Promise<void> {
  const { convertHtml } = await import('./index');
  const html = fs.readFileSync('/dev/stdin', 'utf-8');
  const json = convertHtml(html);

  process.stdout.write(json);
}

main().catch((err) => {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
