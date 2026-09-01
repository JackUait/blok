// Replays update bytes through the real yjs, so the C# → Node direction of the
// interop law is checked against yjs itself and not against our own decoder.
//
//   echo '{"roots":{"m":"map"},"updates":["AAA="],"stateVectorFor":null}' \
//     | node scripts/replay-yjs-update.mjs
//
// Reads one JSON request from stdin, applies every update in order to a fresh
// doc, and prints one JSON line:
//   { "json": <rendered roots>, "sv": "<b64>", "hasPending": bool, "diff": "<b64>|null" }
// `diff` is encodeStateAsUpdate(doc, stateVectorFor) when a state vector is
// given. gc is off so replayed deletions keep the structs a caller asserts on.
// Any failure, malformed input included, writes the error to stderr and exits
// non-zero.
import * as Y from 'yjs';
import { hasPending, renderDoc } from './yjs-engine-render.mjs';

/**
 * @returns {Promise<string>}
 */
async function readStdin() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Uint8Array}
 */
function decodeBase64(value, field) {
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be a base64 string`);
  }

  return new Uint8Array(Buffer.from(value, 'base64'));
}

/**
 * @returns {Promise<void>}
 */
async function main() {
  const request = JSON.parse(await readStdin());

  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('the request must be a JSON object');
  }

  const { roots, updates, stateVectorFor } = request;

  if (roots === null || typeof roots !== 'object' || Array.isArray(roots)) {
    throw new TypeError('"roots" must be an object of root name to kind');
  }

  if (!Array.isArray(updates)) {
    throw new TypeError('"updates" must be an array of base64 strings');
  }

  const doc = new Y.Doc({ gc: false });

  for (const [index, update] of updates.entries()) {
    Y.applyUpdate(doc, decodeBase64(update, `updates[${index}]`));
  }

  const diff = stateVectorFor === null || stateVectorFor === undefined
    ? null
    : Buffer.from(
      Y.encodeStateAsUpdate(doc, decodeBase64(stateVectorFor, '"stateVectorFor"')),
    ).toString('base64');

  const result = {
    json: renderDoc(doc, roots),
    sv: Buffer.from(Y.encodeStateVector(doc)).toString('base64'),
    hasPending: hasPending(doc),
    diff,
  };

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
