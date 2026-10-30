// Generates test/unit/server-conformance/fixtures/jsjson/, the shared oracle for
// the Go jsjson package and the C# JsJson / System.Text.Json paths.
//
//   node scripts/generate-jsjson-fixtures.mjs [--out <dir>] [--skip-dotnet]
//   node scripts/generate-jsjson-fixtures.mjs --print-dotnet-inputs
//
// js.json is what node's own String(number), JSON.stringify and JSON.parse
// answer. dotnet.json is what System.Text.Json answers, captured by
// scripts/capture-jsjson-dotnet.fsx (it reads the cases on stdin).
//
// Every JS string is written as hex UTF-16 units ("units"), never as a JSON
// string: Go's encoding/json turns a lone surrogate into U+FFFD and C#'s
// JsonNode throws on one, so neither reader could load it back.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUT = join(REPO_ROOT, 'test/unit/server-conformance/fixtures/jsjson');
const CAPTURE = join(REPO_ROOT, 'scripts/capture-jsjson-dotnet.fsx');

const units = (text) => [...Array(text.length).keys()]
  .map((index) => text.charCodeAt(index).toString(16).padStart(4, '0'))
  .join('');

const fromUnits = (hex) => String.fromCharCode(
  ...(hex.match(/.{4}/g) ?? []).map((unit) => Number.parseInt(unit, 16)),
);

const view = new DataView(new ArrayBuffer(8));

const bitsOf = (number) => {
  view.setFloat64(0, number);

  return view.getBigUint64(0).toString(16).padStart(16, '0');
};

const numberOf = (bits) => {
  view.setBigUint64(0, BigInt(`0x${bits}`));

  return view.getFloat64(0);
};

// xorshift64: the same bit patterns on every run, and subnormals, huge
// exponents and NaN payloads all show up.
function* seededBits(count) {
  let state = 0x9e3779b97f4a7c15n;
  const mask = (1n << 64n) - 1n;

  for (let index = 0; index < count; index++) {
    state ^= (state << 13n) & mask;
    state ^= state >> 7n;
    state ^= (state << 17n) & mask;
    yield state.toString(16).padStart(16, '0');
  }
}

function numberCases() {
  const values = [
    0, -0, 1, -1, 0.1, 0.2 + 0.1, 1 / 3, 100, 123.456, -1.5,
    NaN, Infinity, -Infinity,
    1e21, 999999999999999900000, 1e21 * (1 - Number.EPSILON), 123456789012345680000,
    1e-6, 1e-7, 1.5e-7, 0.000001234, 123e-20,
    Number.MIN_VALUE, Number.MAX_VALUE, 2.2250738585072014e-308,
    2 ** 53, 2 ** 53 - 1, 2 ** 31, -(2 ** 31), 2 ** 32 - 1, 2 ** 64,
    9007199254740993, 1.7976931348623157e308, 5e-324, 4.9406564584124654e-324,
  ];

  for (let power = -325; power <= 309; power++) {
    values.push(Number(`1e${power}`), Number(`1.5e${power}`), Number(`9.999999999999999e${power}`));
  }

  for (let power = -1074; power <= 1023; power += 7) {
    values.push(2 ** power);
  }

  const bits = [...new Set([...values.map(bitsOf), ...seededBits(2000)])];

  return bits.map((pattern) => [pattern, String(numberOf(pattern))]);
}

// A value spec builds a JS value: null/true/false as themselves,
// {n: bits} a number, {s: units} a string, {u: true} undefined,
// {a: [spec]} an array, {o: [[keyUnits, spec]]} an object in insertion order.
const S = (text) => ({ s: units(text) });
const N = (number) => ({ n: bitsOf(number) });
const O = (...members) => ({ o: members.map(([key, value]) => [units(key), value]) });
const A = (...items) => ({ a: items });
const U = { u: true };

function build(spec) {
  if (spec === null || typeof spec === 'boolean') {
    return spec;
  }

  if ('n' in spec) {
    return numberOf(spec.n);
  }

  if ('s' in spec) {
    return fromUnits(spec.s);
  }

  if ('u' in spec) {
    return undefined;
  }

  if ('a' in spec) {
    return spec.a.map(build);
  }

  const object = {};

  for (const [key, value] of spec.o) {
    object[fromUnits(key)] = build(value);
  }

  return object;
}

const allAscii = String.fromCharCode(...Array.from({ length: 128 }, (_, code) => code));

const STRING_SAMPLES = [
  ['ascii', allAscii],
  ['latin and specials', 'é\u0080 ÿ  ﻿￿'],
  ['astral pair', '😀'],
  ['lone high', 'a\ud800b'],
  ['lone low', 'a\udc00b'],
  ['high at end', 'a\ud83d'],
  ['low at start', '\ude00a'],
  ['reversed pair', '\ude00\ud83d'],
  ['two highs then low', '\ud83d😀'],
  ['html', '<a href="x">&\'+`</a>'],
  ['empty', ''],
];

function stringifyCases() {
  const cases = [
    ['null', null],
    ['true', true],
    ['false', false],
    ['undefined at top', U],
    ['undefined member is skipped', O(['a', U], ['b', N(1)])],
    ['undefined item is null', A(U, N(1))],
    ['non-finite are null', A(N(NaN), N(Infinity), N(-Infinity), N(-0))],
    ['index keys first', O(['b', N(1)], ['2', N(2)], ['1', N(3)], ['01', N(4)], ['-1', N(5)],
      ['4294967294', N(6)], ['4294967295', N(7)], ['1.0', N(8)], ['0', N(9)], ['10', N(10)])],
    ['astral and fullwidth keys keep insertion order', O(['｡', N(2)], ['😀', N(3)], ['a', N(1)])],
    ['nested', O(['x', A(O(['y', S('é')]), A())], ['z', O()])],
    ...STRING_SAMPLES.map(([name, text]) => [`string ${name}`, S(text)]),
    ...STRING_SAMPLES.map(([name, text]) => [`key ${name}`, O([text, N(1)])]),
  ];

  return cases.map(([name, value]) => {
    const json = JSON.stringify(build(value));

    return { name, value, json: json === undefined ? null : json };
  });
}

const deep = (depth) => '['.repeat(depth) + ']'.repeat(depth);

const PARSE_TEXTS = [
  ['whitespace', ' \t\n\r{ "a" : [ 1 , 2 ] } \n'],
  ['scalar', '  1.50  '],
  ['duplicate keeps first place and last value', '{"a":1,"b":2,"a":3}'],
  ['index keys come first', '{"b":1,"2":2,"1":3,"01":4}'],
  ['lone high escape', '"\\ud800"'],
  ['lone low escape', '"\\udc00x"'],
  ['reversed escapes', '"\\udc00\\ud800"'],
  ['paired escapes', '"\\ud83d\\ude00"'],
  ['lone key escape', '{"\\ud800":1}'],
  ['short escapes', '"\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041\\u00e9\\u0001\\u001f"'],
  ['numbers', '[1.0,1e2,-0,1E400,-1e999,5e-324,1e-400,0.1,12345678901234567890123,1e+2,1E-2]'],
  ['raw non-ascii', '["é😀<>&\'+`"]'],
  ['depth 512', deep(512)],
  ['depth 513 (JS has no limit)', deep(513)],
  ['empty containers', '[{},[],""]'],
];

const PARSE_ERRORS = [
  ['trailing comma', '[1,]'],
  ['leading zero', '01'],
  ['bad escape', '"\\x"'],
  ['missing colon', '{"a" 1}'],
  ['truncated literal', 'tru'],
  ['empty', ''],
  ['raw tab in string', '"a\tb"'],
  ['trailing garbage', '[1]x'],
  ['byte order mark', '﻿1'],
  ['single quotes', "'a'"],
  ['comment', '[1]//x'],
  ['NaN literal', 'NaN'],
];

function parseCases() {
  return [
    ...PARSE_TEXTS.map(([name, text]) => ({ name, text, json: JSON.stringify(JSON.parse(text)) })),
    ...PARSE_ERRORS.map(([name, text]) => {
      try {
        JSON.parse(text);
      } catch {
        return { name, text, json: null };
      }

      throw new Error(`JSON.parse accepted the error case ${name}`);
    }),
  ];
}

function buildJsFixture() {
  view.setFloat64(0, NaN);

  return {
    about: 'Generated by scripts/generate-jsjson-fixtures.mjs from node. Strings are hex UTF-16 units.',
    nanBits: view.getBigUint64(0).toString(16).padStart(16, '0'),
    numbers: numberCases(),
    stringify: stringifyCases(),
    parse: parseCases(),
  };
}

const deepObject = (depth) => '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);

// maxDepth 0 is .NET's default (64). refuseDuplicates is
// AllowDuplicateProperties = false, as CollabEditOps and DocEndpointClient set.
function dotnetInputs() {
  const documents = [
    ['whitespace and order', '  { "b" : 1.0 , "a" : [ 1 , 2 ] }  '],
    ['numbers stay verbatim', '[1.0,1e2,-0,-0.0,1E400,1e+2,1E-2,0.10,12345678901234567890123]'],
    ['scalar', '  1.50  '],
    ['null', 'null'],
    ['empty containers', '[{},[],""]'],
    ['escapes are decoded then re-escaped', '"\\u0041\\/\\u00e9\\u00E9\\"\\\\\\b\\f\\n\\r\\t\\u0001"'],
    ['raw ascii', JSON.stringify(allAscii)],
    ['raw non-ascii', '"é\u0080  ￿😀"'],
    ['html', '"<a href=\\"x\\">&\'+`</a>"'],
    ['keys sort by UTF-16 units', '{"｡":2,"😀":3,"b":1,"B":0,"a":[{"z":1,"y":2}],"\\u0061b":4}'],
    ['duplicate keys', '{"a":1,"a":2}'],
    ['escaped duplicate keys', '{"a":1,"\\u0061":2}'],
    ['nested duplicate keys', '[{"a":1,"a":2}]'],
    ['duplicate then truncated', '{"a":1,"a":2'],
    ['duplicate then too deep', `{"a":1,"a":${deep(513)}}`],
    ['lone key twice', '{"\\ud800":1,"\\ud800":2}'],
    ['duplicate then lone key', '{"a":1,"a":2,"\\ud800":3}'],
    ['lone key then duplicate', '{"\\ud800":1,"a":1,"a":2}'],
    ['lone high', '"\\ud800"'],
    ['lone low', '{"a":"\\udc00x"}'],
    ['lone key', '{"\\ud800":1}'],
    ['paired escapes', '"\\ud83d\\ude00"'],
    ['array depth 64', deep(64)],
    ['array depth 65', deep(65)],
    ['array depth 512', deep(512)],
    ['array depth 513', deep(513)],
    ['object depth 512', deepObject(512)],
    ['object depth 513', deepObject(513)],
    ['trailing comma', '[1,]'],
    ['leading zero', '01'],
    ['raw tab in string', '"a\tb"'],
    ['comment', '[1]//x'],
    ['trailing garbage', '[1]x'],
    ['empty', ''],
    ['bad escape', '"\\x"'],
    ['lone minus', '-'],
    ['dot without digits', '1.'],
    ['exponent without digits', '1e'],
  ];
  const hexDocuments = [
    ['byte order mark', 'efbbbf31'],
    ['invalid byte in string', '22ff4122'],
    ['overlong in string', '22c08022'],
    ['3-byte overlong in string', '22e0808022'],
    ['encoded surrogate in string', '22eda08022'],
    ['truncated 3-byte in string', '22e28222'],
    ['truncated 4-byte in string', '22f09f9822'],
    ['f0 80 in string', '22f080808022'],
    ['above U+10FFFF in string', '22f490808022'],
    ['invalid byte in key', '7b22ff223a317d'],
    ['two different invalid keys', '7b22ff223a312c22fe223a327d'],
    ['same invalid key twice', '7b22ff223a312c22ff223a327d'],
    ['invalid byte outside a string', '5bff5d'],
    ['NUL escape and raw DEL', '225c75303030307f22'],
  ];
  const options = [
    ['', 0, false],
    [' (512)', 512, false],
    [' (512, no duplicates)', 512, true],
  ];
  const variants = (entry) => options.map(([suffix, maxDepth, refuseDuplicates]) =>
    ({ ...entry, name: entry.name + suffix, maxDepth, refuseDuplicates }));

  return {
    documents: [
      ...documents.flatMap(([name, text]) => variants({ name, text })),
      ...hexDocuments.flatMap(([name, hex]) => variants({ name, hex })),
    ],
    strings: STRING_SAMPLES.map(([name, text]) => ({ name, units: units(text) })),
  };
}

// One [bits, text] pair per line keeps the number table reviewable.
const serialize = (value) => `${JSON.stringify(value, null, 2)
  .replace(/\[\n\s+("[0-9a-f]{16}"),\n\s+("[^"\n]*")\n\s+\]/g, '[$1, $2]')}\n`;

function main(args) {
  if (args.includes('--print-dotnet-inputs')) {
    process.stdout.write(JSON.stringify(dotnetInputs()));

    return;
  }

  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args[outAt + 1] : DEFAULT_OUT;

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'js.json'), serialize(buildJsFixture()));

  if (args.includes('--skip-dotnet')) {
    return;
  }

  const captured = execFileSync('dotnet', ['fsi', '--quiet', CAPTURE], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    input: JSON.stringify(dotnetInputs()),
    maxBuffer: 64 * 1024 * 1024,
  });

  writeFileSync(join(out, 'dotnet.json'), serialize({
    about: 'Captured from System.Text.Json by scripts/capture-jsjson-dotnet.fsx. Strings are hex UTF-16 units.',
    ...JSON.parse(captured),
  }));
}

main(process.argv.slice(2));
