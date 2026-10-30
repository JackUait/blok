/**
 * Put the icons dist/blok.mjs needs at load in one chunk, and let the bundler
 * place every other icon next to the code that draws it. A page that loads
 * dist without a bundler then skips the tool-only icons, and a lazy UI that
 * draws one icon downloads only that one. One group for the other icons would
 * make every lazy UI download all of them.
 *
 * Rolldown keeps a module whole in one chunk, so the build splits the icons
 * file into one virtual module per export. The source stays one file because
 * its tests, its README and scripts/generate-icons-dts.mjs read it as written.
 * Any statement other than a single `const` throws, so a new shape cannot be
 * split wrong in silence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseAst } from 'vite';

const PREFIX = '\0blok-icon:';

export default function splitIconsPlugin(iconsFile, coreEntry) {
  const target = path.resolve(iconsFile);
  const entry = path.resolve(coreEntry);
  const srcDir = path.dirname(entry) + path.sep;
  // name -> TS source of that one export, with the local helpers it calls
  let modules = new Map();
  // module id -> icon names its source mentions
  const mentions = new Map();
  let coreIcons = null;

  const split = (code) => {
    const program = parseAst(code, { lang: 'ts' });
    const helpers = new Map();
    const exports = new Map();

    for (const node of program.body) {
      const text = code.slice(node.start, node.end);
      const declaration = node.type === 'ExportNamedDeclaration' ? node.declaration : node;

      if (declaration?.type !== 'VariableDeclaration' || declaration.declarations.length !== 1) {
        throw new Error(`blok:split-icons: unexpected statement in ${target}: ${text.slice(0, 80)}`);
      }

      (node === declaration ? helpers : exports).set(declaration.declarations[0].id.name, text);
    }

    modules = new Map([...exports].map(([name, text]) => {
      const used = [...helpers].filter(([helper]) => new RegExp(`\\b${helper}\\b`).test(text));

      return [name, [...used.map(([, helper]) => helper), text].join('\n')];
    }));

    return [...modules.keys()].map((name) => `export { ${name} } from ${JSON.stringify(PREFIX + name)};`).join('\n');
  };

  // Icons named by any module blok.ts reaches through static imports. Source
  // words can over-count (a use the minifier drops), never under-count.
  const iconsOfCore = (ctx) => {
    const seen = new Set();
    const found = new Set();
    const stack = [entry];

    while (stack.length > 0) {
      const id = stack.pop();

      if (seen.has(id) || id === target) {
        continue;
      }
      seen.add(id);
      mentions.get(id)?.forEach((name) => found.add(name));
      stack.push(...(ctx.getModuleInfo(id)?.importedIds ?? []));
    }

    return found;
  };

  const iconGroup = {
    name: (id, ctx) => {
      if (!id.startsWith(PREFIX)) {
        return null;
      }
      coreIcons ??= iconsOfCore(ctx);

      return coreIcons.has(id.slice(PREFIX.length)) ? 'icons-core' : null;
    },
  };

  return {
    name: 'blok:split-icons',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      mentions.clear();
      split(fs.readFileSync(target, 'utf8'));
    },
    transform(code, id) {
      if (id.split('?')[0] === target) {
        return { code: split(code), map: null };
      }
      if (id.startsWith(srcDir)) {
        mentions.set(id, new Set((code.match(/\b[A-Za-z]\w*\b/g) ?? []).filter((word) => modules.has(word))));
      }

      return null;
    },
    renderStart() {
      coreIcons = null;
    },
    outputOptions(options) {
      const splitting = options.codeSplitting;

      if (!['es', 'cjs'].includes(options.format) || splitting === false || options.inlineDynamicImports === true) {
        return null;
      }

      const base = typeof splitting === 'object' ? splitting : {};

      return { ...options, codeSplitting: { ...base, groups: [...(base.groups ?? []), iconGroup] } };
    },
    resolveId(id) {
      return id.startsWith(PREFIX) ? id : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) {
        return null;
      }

      const code = modules.get(id.slice(PREFIX.length));

      if (code === undefined) {
        throw new Error(`blok:split-icons: ${id} requested before ${target} was read`);
      }

      return { code, map: null, moduleType: 'ts' };
    },
  };
}
