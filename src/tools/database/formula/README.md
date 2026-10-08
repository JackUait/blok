# Formula engine

A pure Notion **Formulas 2.0** engine: tokenizer → parser (AST) → type checker → evaluator.
No DOM, no dependencies, no wiring into the database yet.

## Sources

| Key | URL | Fetched |
| --- | --- | --- |
| H-fxs | https://www.notion.com/help/formula-syntax | 2026-10-09 (curl) |
| H-fx | https://www.notion.com/help/formulas | 2026-10-09 (curl) |
| H-err | https://www.notion.com/help/common-formula-errors | 2026-10-09 (curl) |
| H-2.0 | https://www.notion.com/help/guides/new-formulas-whats-changed | 2026-10-09 (curl, toggle text read from the page data) |
| D-po | https://developers.notion.com/reference/property-object (formula section) | 2026-10-09 (curl `.md`) |
| D-ppv | https://developers.notion.com/reference/page-property-values (formula section) | 2026-10-09 (curl `.md`) |

Anything marked **unverified** is a choice made where those pages say nothing.

## API

```ts
compileFormula(source: string, schema: PropertyDefinition[]):
  | { ok: true; formula: CompiledFormula; resultType: FormulaType }
  | { ok: false; error: { message: string; start: number; end: number } };

evaluateFormula(compiled: CompiledFormula, row: DatabaseRow,
  ctx: { now: Date; timeZone?: string; schema: PropertyDefinition[]; people?: (id) => { name?; email? } | undefined }): FormulaValue;

serializeFormula(compiled: CompiledFormula): string;          // prop("Name") -> {{property:<id>}}
formatFormulaForDisplay(stored: string, schema): string;      // {{property:<id>}} -> prop("Current name")
formulaValueToText(value: FormulaValue, { timeZone?, people? }): string;   // what format() prints
formulaDateToStored(date: FormulaDate, timeZone?): string;    // "YYYY-MM-DD", "YYYY-MM-DDTHH:mm", "a/b"
FORMULA_FUNCTION_NAMES: readonly string[];
```

- `compileFormula` accepts both `prop("Name")` and the stored `{{property:id}}` form.
  D-po: "The saved formula refers to its ID, so a later rename does not break that reference."
  The stored token shape `{{property:id}}` is Blok's own; Notion's API uses `{{notion:block_property:...}}`.
- `serializeFormula` keeps the user's spacing and `/* comments */`; only the property references change.
- `now()` and `today()` read `ctx.now`. Nothing reads the system clock.
- Dates use `Intl.DateTimeFormat#formatToParts` with numeric fields only, so results do not depend on a Node version's ICU strings. Month and weekday names are hard-coded English.

## Types

| Formula type | Runtime value |
| --- | --- |
| Number | `number` (never `-0`, never NaN or ±Infinity: those become empty — **unverified**) |
| Text | `string`, or `{ kind: 'richText', runs }` after `style()` / `link()` |
| Boolean | `boolean` |
| Date | `{ kind: 'date', start, end?, hasTime }` (epoch ms) |
| Person / Page | `{ kind: 'person' \| 'page', id }` (opaque ids) |
| List | `FormulaValue[]` |
| Empty | `null` |

Property → formula type, from H-fxs "Properties": Title, Text, URL, rich text and Select → Text (a select reads as its option **label**); Multi-select → Text (list); Checkbox → Boolean; Number → Number; Date → Date; `person` → Person (list); `relation` → Page (list). `person` and `relation` are not Blok property types yet; the map is keyed by name so they light up when they land. A rich-text cell holding legacy `OutputData` reads as `""` (**unverified**).

Stored dates: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm` (local wall time in `ctx.timeZone`), or `start/end`. `formulaDateToStored` writes the same forms back; a wall time inside a DST gap (New York `2023-03-12T02:30`) moves forward by the gap, as JS `Date` does, so it comes back as `03:30` (**unverified**). A wall time that occurs twice resolves to the first occurrence. The parser in `dates.ts` (`parseStoredDate`) is a stand-in for `parseDateValue` in `src/tools/database/cells/date-value.ts` (branch p1-cells); swap it when that merges.

## Operators and precedence

H-fxs "Built-ins" lists the operators but not their precedence. The order below follows JavaScript, which Formulas 2.0 resembles (**unverified**), lowest first:

| Level | Operators | Notes |
| --- | --- | --- |
| 1 | `? :` | right-associative; `X ? Y : Z` = `if(X, Y, Z)` (H-fxs) |
| 2 | `or`, `\|\|` | |
| 3 | `and`, `&&` | |
| 4 | `==`, `!=` | `===` and `!==` are read as `==` / `!=`; H-fxs uses `!==` in an example |
| 5 | `>`, `>=`, `<`, `<=` | Number, Text or Date on both sides; anything else is a compile error |
| 6 | `+`, `-` | `+` joins text when either side is text (`"(" + 50 + ")%"`, H-2.0) |
| 7 | `*`, `/`, `%` | |
| 8 | prefix `-`, `not`, `!` | `-2 ^ 2` = `-4` (**unverified**) |
| 9 | `^` | right-associative (**unverified**) |
| 10 | `f(...)`, `.f(...)`, `.f` | dot calls pass the receiver as argument 1 (H-2.0 "Dot notation"); `current.length` without parentheses (H-fxs `some` example) |

`/* block comments */` and line breaks are allowed (H-2.0). Line comments (`//`) are not (**unverified**).
Strings use double quotes; `\"`, `\\`, `\n`, `\t` are escapes, so `"\\d"` is the regex `\d` (H-fxs `test` example).

## Empty values

- `empty()` with no argument is the empty value. It fits either branch of `if()` (H-err, "Wrong return type").
- `if()` branches of different types are a compile error: `if(Date, Date.dateAdd(1, "day"), "")` fails, `... , empty())` compiles (H-err).
- Conditions take any type. `false`, `0`, `""`, `[]` and empty are false (H-fxs `empty`: "0, "", and [] are considered empty"; `false` counting as empty is **unverified**).
- A function given an empty argument returns empty, except `empty`, `format`, `equal`, `unequal`, `includes` (**unverified**). So `prop("Price") + 1` is empty when Price is empty.
- `"x" + empty` is `"x"`. `<`, `>` with an empty side are `false`. `sort` puts empties last (D8).

## Number formatting

`format()` prints a number the way JavaScript's `String()` does: `format(1234)` = `"1234"` (H-fxs), `1 / 3` → `"0.3333333333333333"`, `0.1 + 0.2` → `"0.30000000000000004"` (**unverified** beyond the H-fxs example). H-fxs prints `sqrt(7)` = `2.6457513110645907`, so results are not rounded to fewer digits.

## Functions

Every name the engine accepts. `readme.test.ts` fails if this table and `FORMULA_FUNCTION_NAMES` drift apart.

| Function | Signature | Source | Notes |
| --- | --- | --- | --- |
| `prop` | `prop("Name")` → property type | https://www.notion.com/help/formula-syntax | `current.prop(...)` on a related page is not supported yet |
| `if` | `if(cond, a, b)` | https://www.notion.com/help/formula-syntax | lazy |
| `ifs` | `ifs(c1, v1, c2, v2, ..., fallback)` | https://www.notion.com/help/formula-syntax | fallback required (**unverified**) |
| `and` | `and(a, b, ...)` → Boolean | https://www.notion.com/help/formula-syntax | more than 2 arguments **unverified** |
| `or` | `or(a, b, ...)` → Boolean | https://www.notion.com/help/formula-syntax | as `and` |
| `empty` | `empty()` → Empty; `empty(x)` → Boolean | https://www.notion.com/help/formula-syntax | zero-arg form from https://www.notion.com/help/common-formula-errors |
| `length` | `length(text \| list)` → Number | https://www.notion.com/help/formula-syntax | counts code points (**unverified**) |
| `format` | `format(any)` → Text | https://www.notion.com/help/formula-syntax | date: "August 30, 2023 17:55"; list: items joined with ", " (**unverified**); person: name, else id |
| `equal` | `equal(a, b)` → Boolean | https://www.notion.com/help/formula-syntax | deep for lists |
| `unequal` | `unequal(a, b)` → Boolean | https://www.notion.com/help/formula-syntax | |
| `toNumber` | `toNumber(text \| number \| boolean \| date)` → Number | https://www.notion.com/help/formula-syntax | non-numeric text → empty (**unverified**) |
| `substring` | `substring(text, start, end?)` | https://www.notion.com/help/formula-syntax | negative indexes clamp to 0 (**unverified**) |
| `contains` | `contains(text, search)` → Boolean | https://www.notion.com/help/formula-syntax | |
| `test` | `test(text, regex)` → Boolean | https://www.notion.com/help/formula-syntax | JS RegExp; invalid pattern → empty (**unverified**) |
| `match` | `match(text, regex)` → Text (list) | https://www.notion.com/help/formula-syntax | |
| `replace` | `replace(text, regex, replacement)` | https://www.notion.com/help/formula-syntax | first match |
| `replaceAll` | `replaceAll(text, regex, replacement)` | https://www.notion.com/help/formula-syntax | H-fxs shows `replaceAll("Notion 123", "\\d", "")` = `"Notion"`; the real result keeps the space: `"Notion "` |
| `lower` | `lower(text)` | https://www.notion.com/help/formula-syntax | |
| `upper` | `upper(text)` | https://www.notion.com/help/formula-syntax | |
| `trim` | `trim(text)` | https://www.notion.com/help/formula-syntax | |
| `repeat` | `repeat(text, n)` | https://www.notion.com/help/formula-syntax | |
| `padStart` | `padStart(text, length, pad = " ")` | not on the help page | **unverified**: JS `padStart` |
| `padEnd` | `padEnd(text, length, pad = " ")` | not on the help page | **unverified**: JS `padEnd` |
| `link` | `link(label, url)` → Text | https://www.notion.com/help/formula-syntax | rich text run with `link` |
| `style` | `style(text, ...styles)` → Text | https://www.notion.com/help/formula-syntax | `b u i c s`, 9 colors, `<color>_background`; unknown names ignored (**unverified**) |
| `unstyle` | `unstyle(text, ...styles?)` → Text | https://www.notion.com/help/formula-syntax | no styles = remove all; links stay (**unverified**) |
| `split` | `split(text, separator)` → Text (list) | https://www.notion.com/help/formula-syntax | literal separator (**unverified**) |
| `join` | `join(list, joiner)` → Text | https://www.notion.com/help/formula-syntax | items via `format()` |
| `formatNumber` | `formatNumber(number, format = "number", decimals?)` → Text | https://www.notion.com/help/formula-syntax | the page shows only `formatNumber(x, "usd", 0)`. Formats `number`, `number_with_commas`, `percent` and a few currency codes/names are **unverified**; unknown format → empty |
| `add` | `add(a, b)` | https://www.notion.com/help/formula-syntax | |
| `subtract` | `subtract(a, b)` | https://www.notion.com/help/formula-syntax | |
| `multiply` | `multiply(a, b)` | https://www.notion.com/help/formula-syntax | |
| `divide` | `divide(a, b)` | https://www.notion.com/help/formula-syntax | `/ 0` → empty (**unverified**) |
| `mod` | `mod(a, b)` | https://www.notion.com/help/formula-syntax | JS `%` sign rules (**unverified**) |
| `pow` | `pow(base, exp)` | https://www.notion.com/help/formula-syntax | |
| `abs` | `abs(x)` | https://www.notion.com/help/formula-syntax | |
| `round` | `round(x, places = 0)` | https://www.notion.com/help/formula-syntax | half rounds up, like JS `Math.round` (**unverified**) |
| `ceil` | `ceil(x)` | https://www.notion.com/help/formula-syntax | |
| `floor` | `floor(x)` | https://www.notion.com/help/formula-syntax | |
| `sqrt` | `sqrt(x)` | https://www.notion.com/help/formula-syntax | |
| `cbrt` | `cbrt(x)` | https://www.notion.com/help/formula-syntax | |
| `exp` | `exp(x)` | https://www.notion.com/help/formula-syntax | |
| `ln` | `ln(x)` | https://www.notion.com/help/formula-syntax | |
| `log10` | `log10(x)` | https://www.notion.com/help/formula-syntax | |
| `log2` | `log2(x)` | https://www.notion.com/help/formula-syntax | |
| `sign` | `sign(x)` | https://www.notion.com/help/formula-syntax | |
| `pi` | `pi()` | https://www.notion.com/help/formula-syntax | |
| `e` | `e()` | https://www.notion.com/help/formula-syntax | |
| `min` | `min(number \| Number (list), ...)` | https://www.notion.com/help/formula-syntax | nothing → empty (**unverified**) |
| `max` | `max(...)` | https://www.notion.com/help/formula-syntax | as `min` |
| `sum` | `sum(...)` | https://www.notion.com/help/formula-syntax | nothing → 0 (**unverified**) |
| `mean` | `mean(...)` | https://www.notion.com/help/formula-syntax | |
| `median` | `median(...)` | https://www.notion.com/help/formula-syntax | |
| `now` | `now()` → Date with time | https://www.notion.com/help/formula-syntax | `ctx.now` |
| `today` | `today()` → Date without time | https://www.notion.com/help/formula-syntax | local midnight in `ctx.timeZone` |
| `minute` | `minute(date)` 0-59 | https://www.notion.com/help/formula-syntax | |
| `hour` | `hour(date)` 0-23 | https://www.notion.com/help/formula-syntax | in `ctx.timeZone`; see Conflicts |
| `day` | `day(date)` 1 (Mon) - 7 (Sun) | https://www.notion.com/help/formula-syntax | 2.0 change from 0-6: https://www.notion.com/help/guides/new-formulas-whats-changed |
| `date` | `date(date)` 1-31 | https://www.notion.com/help/formula-syntax | |
| `week` | `week(date)` ISO 1-53 | https://www.notion.com/help/formula-syntax | |
| `month` | `month(date)` 1-12 | https://www.notion.com/help/formula-syntax | 2.0 change from 0-11: https://www.notion.com/help/guides/new-formulas-whats-changed |
| `year` | `year(date)` | https://www.notion.com/help/formula-syntax | |
| `dateAdd` | `dateAdd(date, n, unit)` | https://www.notion.com/help/formula-syntax | units: years, quarters, months, weeks, days, hours, minutes; singular forms accepted (H-fx uses `"week"`, H-err `"day"`). Calendar units keep wall time across DST; month overflow clamps (Jan 31 + 1 month = Feb 28) (**unverified**). Unknown unit → empty (**unverified**) |
| `dateSubtract` | `dateSubtract(date, n, unit)` | https://www.notion.com/help/formula-syntax | as `dateAdd` |
| `dateBetween` | `dateBetween(a, b, unit)` → Number | https://www.notion.com/help/formula-syntax | `a - b`, truncated toward zero; months use moment.js `monthDiff` (**unverified**; it reproduces the two H-fxs examples) |
| `dateRange` | `dateRange(start, end)` → Date | https://www.notion.com/help/formula-syntax | |
| `dateStart` | `dateStart(date)` | https://www.notion.com/help/formula-syntax | renamed from `start` in 2.0 |
| `dateEnd` | `dateEnd(date)` | https://www.notion.com/help/formula-syntax | renamed from `end` in 2.0; no end → the start (**unverified**) |
| `timestamp` | `timestamp(date)` → ms | https://www.notion.com/help/formula-syntax | |
| `fromTimestamp` | `fromTimestamp(ms)` → Date | https://www.notion.com/help/formula-syntax | drops seconds and ms, as documented |
| `formatDate` | `formatDate(date, pattern)` → Text | https://www.notion.com/help/formula-syntax | documented: `YYYY MM DD h mm`, plus `MMMM D Y A` from the examples. `h` is 0-23 because H-fxs shows `"h:mm A"` = `"17:55 PM"`. Also `YY Q MMM M Do dddd ddd HH H hh mm m ss s a WW W [literal]` (**unverified**) |
| `parseDate` | `parseDate(text)` → Date | https://www.notion.com/help/formula-syntax | ISO 8601; no offset = `ctx.timeZone`; invalid → empty (**unverified**) |
| `name` | `name(person)` → Text | https://www.notion.com/help/formula-syntax | via `ctx.people`; unknown → empty |
| `email` | `email(person)` → Text | https://www.notion.com/help/formula-syntax | via `ctx.people` |
| `id` | `id(page?)` → Text | https://www.notion.com/help/formula-syntax | no argument = the row block's id |
| `at` | `at(list, index)` | https://www.notion.com/help/formula-syntax | negative counts from the end, out of range → empty (**unverified**) |
| `first` | `first(list)` | https://www.notion.com/help/formula-syntax | |
| `last` | `last(list)` | https://www.notion.com/help/formula-syntax | |
| `slice` | `slice(list, start, end?)` | https://www.notion.com/help/formula-syntax | lists only in 2.0 (text uses `substring`) |
| `concat` | `concat(list, list, ...)` | https://www.notion.com/help/formula-syntax | lists only in 2.0: https://www.notion.com/help/guides/new-formulas-whats-changed |
| `sort` | `sort(list)` | https://www.notion.com/help/formula-syntax | text by code unit, not locale (**unverified**); empties last |
| `reverse` | `reverse(list)` | https://www.notion.com/help/formula-syntax | |
| `unique` | `unique(list)` | https://www.notion.com/help/formula-syntax | deep equality |
| `includes` | `includes(list, value)` → Boolean | https://www.notion.com/help/formula-syntax | |
| `find` | `find(list, condition)` | https://www.notion.com/help/formula-syntax | `current`, `index` |
| `findIndex` | `findIndex(list, condition)` → Number | https://www.notion.com/help/formula-syntax | -1 when none |
| `filter` | `filter(list, condition)` | https://www.notion.com/help/formula-syntax | condition must be Boolean (**unverified**) |
| `some` | `some(list, condition)` → Boolean | https://www.notion.com/help/formula-syntax | |
| `every` | `every(list, condition)` → Boolean | https://www.notion.com/help/formula-syntax | |
| `map` | `map(list, expression)` | https://www.notion.com/help/formula-syntax | `current + index` example |
| `flat` | `flat(list)` | https://www.notion.com/help/formula-syntax | one level |
| `let` | `let(name, value, expression)` | https://www.notion.com/help/formula-syntax | |
| `lets` | `lets(a, v1, b, v2, ..., expression)` | https://www.notion.com/help/formula-syntax | later values may use earlier names (**unverified**) |

`current` and `index` are keywords inside `find`, `findIndex`, `filter`, `some`, `every` and `map` (H-fxs). Outside them they are a compile error.

Removed in 2.0 and rejected as unknown functions (H-2.0): `larger`, `largerEq`, `smaller`, `smallerEq`, `start`, `end`, and `slice` / `concat` on text.

## Error messages

Notion's pages do not quote their editor's error text, so every message here is Blok's own wording (**unverified**). Each error carries the `start`/`end` offsets of the offending source.

## Conflicts in the sources

- H-fxs's examples share one clock: `timestamp(now())` = `1693443300000` (2023-08-31T00:55Z). They are true in America/Los_Angeles (`format(now())` = "August 30, 2023 17:55", `parseDate("2022-01-01T00:00Z")` = Dec 31, 2021 4:00 PM, `fromTimestamp(1689024900000)` = 2:35 PM), except `hour(parseDate("2023-07-10T17:35Z"))` = `17`, which only holds in UTC. Tests pin each example in the zone that makes it true.
- H-fxs `today()` = "April 19, 2024" uses a different clock; not pinned.
- D-po shows `prop("Price") * 1.1` = `11` for Price 10; JavaScript gives `11` too, so no rounding rule is implied.

## Not done yet

- `x.Property` dot access and `current.prop("Status")` on related pages (needs relation data).
- Rollups, Created/Edited time and by, Status, Email/Phone, Unique ID, Files: no Blok property types yet.
- The 15-layer formula-on-formula depth limit (H-err) applies once formula properties can reference each other.
- Person/Page values come back as ids; display needs a host resolver (`ctx.people`; pages have none yet).
