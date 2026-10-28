#!/bin/sh
# Rebuilds grammar-structure.json and golden-html.json from the real Prism.
# prismjs is not a dependency: install it first, e.g. `yarn add -D prismjs@1.30.0`,
# then remove it again (keep package.json and yarn.lock unchanged).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$(mktemp)
node "$HERE/corpus.cjs" "$OUT"
node "$HERE/oracle.cjs" "$OUT"
node -e "
const fs=require('fs'),c=require('crypto');
const p='$HERE/../golden-html.json';
const cases=JSON.parse(fs.readFileSync(p,'utf8')).map(x=>x.source.startsWith('upstream:')?{lang:x.lang,source:x.source,sha256:c.createHash('sha256').update(x.html).digest('hex')}:x);
fs.writeFileSync(p,'[\n'+cases.map(x=>JSON.stringify(x)).join(',\n')+'\n]\n');
console.log('golden', cases.length, 'cases');
"
rm -f "$OUT"
