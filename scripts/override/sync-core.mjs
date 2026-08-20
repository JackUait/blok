import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const hashOf = (content) => createHash('sha256').update(content).digest('hex').slice(0, 12);

export const payloadFileName = (hash) => `blok-override.${hash}.js`;

// Chrome loads content-script files through base::IsStringUTF8, which rejects
// Unicode noncharacters (U+FDD0–U+FDEF, U+nFFFE/U+nFFFF) that minifiers emit
// raw inside string/regex literals (e.g. a parser's `￿` EOF sentinel) —
// registration then fails with "It isn't UTF-8 encoded". Escaping is
// semantics-preserving: these code points are only legal inside literals,
// where the \u sequence denotes the identical character. The astral branch
// matches any surrogate pair ending in DFFE/DFFF and re-checks the code point,
// because those low surrogates also terminate ordinary characters.
const NONCHARACTERS = /[﷐-﷯￾￿]|[\uD800-\uDBFF][\uDFFE\uDFFF]/g;
const escapeUnit = (ch) => `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
const escapeNoncharacters = (code) => code.replace(NONCHARACTERS, (match) => {
  if (match.length === 2 && ((match.codePointAt(0) & 0xFFFE) !== 0xFFFE)) {
    return match;
  }
  return match.split('').map(escapeUnit).join('');
});

export function stagePayload(payloadDir, rawCode, meta) {
  mkdirSync(payloadDir, { recursive: true });
  const code = escapeNoncharacters(rawCode);
  const hash = hashOf(code);
  const file = payloadFileName(hash);
  writeFileSync(join(payloadDir, file), code);
  // builtAt is stamped HERE, not by callers: watch mode restages on every
  // rebuild with metadata captured when the watcher started, so a caller-side
  // timestamp would freeze "Built Xh ago" for the whole watch session.
  writeFileSync(join(payloadDir, 'current.json'), `${JSON.stringify({ file, hash, ...meta, builtAt: new Date().toISOString() }, null, 2)}\n`);
  for (const stale of readdirSync(payloadDir)) {
    if (stale.startsWith('blok-override.') && stale !== file) {
      rmSync(join(payloadDir, stale));
    }
  }
  return { file };
}

export function stageDist(payloadDir, distDir) {
  if (!existsSync(distDir)) {
    return null;
  }
  const target = join(payloadDir, 'dist');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(payloadDir, { recursive: true });
  cpSync(distDir, target, { recursive: true });
  let files = 0;
  const count = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        count(join(dir, entry.name));
      } else {
        files += 1;
      }
    }
  };
  count(target);
  return { files };
}
