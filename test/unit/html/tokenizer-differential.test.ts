// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Tokenizer as Parse5Tokenizer, TokenizerMode as Parse5Mode } from 'parse5';
import { Tokenizer } from '../../../src/html/tokenizer';
import { TokenizerMode } from '../../../src/html/token';
import { fuzzHtml, realDocuments, storedFields, treeConstructionInputs } from './corpus';
import { hitsEntitiesBug } from './entities-oracle-bug';
import { repairSurrogates } from '../../../src/view/html-text';
import { Collector, type Collected } from './token-collector';

/** What the tree builder may set on a tokenizer: the same three fields on ours and parse5's. */
interface Control {
  state: number;
  inForeignNode: boolean;
  lastStartTagName: string;
}

const MODES = [TokenizerMode.DATA, TokenizerMode.RCDATA, TokenizerMode.RAWTEXT, TokenizerMode.SCRIPT_DATA, TokenizerMode.PLAINTEXT];
const PARSE5_MODES = [Parse5Mode.DATA, Parse5Mode.RCDATA, Parse5Mode.RAWTEXT, Parse5Mode.SCRIPT_DATA, Parse5Mode.PLAINTEXT];

const TEXT_MODES: Record<string, TokenizerMode> = {
  textarea: TokenizerMode.RCDATA,
  title: TokenizerMode.RCDATA,
  style: TokenizerMode.RAWTEXT,
  xmp: TokenizerMode.RAWTEXT,
  iframe: TokenizerMode.RAWTEXT,
  noembed: TokenizerMode.RAWTEXT,
  noframes: TokenizerMode.RAWTEXT,
  noscript: TokenizerMode.RAWTEXT,
  script: TokenizerMode.SCRIPT_DATA,
  plaintext: TokenizerMode.PLAINTEXT,
};
const INTEGRATION_POINTS = new Set(['foreignobject', 'desc', 'title', 'mi', 'mo', 'mn', 'ms', 'mtext']);
const BREAKOUTS = new Set(['b', 'p', 'div', 'br', 'span', 'ul', 'li', 'table', 'pre', 'code', 'em', 'strong', 'img', 'h1', 'font']);

/**
 * Reacts to tokens the way a tree builder would: switches text modes and
 * tracks svg/math so `inForeignNode` changes. It need not be a correct tree
 * builder, only react the same way to the same tokens on both tokenizers.
 */
class FeedbackSimulator extends Collector {
  /** The tokenizer this one drives; set right after both exist. */
  public control: Control = { state: 0, inForeignNode: false, lastStartTagName: '' };
  private readonly stack: string[] = [];

  constructor(private readonly modes: number[], checkKinds: boolean) {
    super(checkKinds);
  }

  public onStartTag(token: { tagName: string; selfClosing: boolean; attrs: Array<{ name: string; value: string }> }): void {
    super.onStartTag(token);
    const name = token.tagName.toLowerCase();
    const top = this.stack[this.stack.length - 1];
    const foreign = top !== undefined && top !== 'html';

    if (foreign && BREAKOUTS.has(name)) {
      this.stack.length = 0;
    } else if (foreign && INTEGRATION_POINTS.has(name) && !token.selfClosing) {
      this.stack.push('html');
    } else if ((name === 'svg' || name === 'math') && !token.selfClosing) {
      this.stack.push(name);
    } else if (!foreign && name in TEXT_MODES) {
      this.control.state = this.modes[TEXT_MODES[name]];
    }
    this.sync();
  }

  public onEndTag(token: { tagName: string; selfClosing: boolean; attrs: Array<{ name: string; value: string }> }): void {
    super.onEndTag(token);
    const name = token.tagName.toLowerCase();

    if (this.stack.length > 0 && (name === 'svg' || name === 'math' || INTEGRATION_POINTS.has(name))) {
      this.stack.pop();
    }
    this.sync();
  }

  private sync(): void {
    const top = this.stack[this.stack.length - 1];

    this.control.inForeignNode = top !== undefined && top !== 'html';
  }
}

interface Start {
  mode: TokenizerMode;
  lastStartTagName: string;
  foreign: boolean;
}

const DATA: Start = { mode: TokenizerMode.DATA, lastStartTagName: '', foreign: false };

/** Our tokens, or null when ours throws like parse5 (see `rejectLikeParse5`). */
const ours = (html: string, start: Start): { tokens: Collected; mixed: string[] } | null => {
  const simulator = new FeedbackSimulator(MODES, true);
  const tokenizer = new Tokenizer(simulator);

  simulator.control = tokenizer;
  tokenizer.state = start.mode;
  tokenizer.lastStartTagName = start.lastStartTagName;
  tokenizer.inForeignNode = start.foreign;
  try {
    tokenizer.write(html);
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }

  return { tokens: simulator.tokens, mixed: simulator.mixed };
};

/** parse5's tokens, or null when parse5 throws (two low surrogates in a row). */
const theirs = (html: string, start: Start): Collected | null => {
  const simulator = new FeedbackSimulator(PARSE5_MODES, false);
  const tokenizer = new Parse5Tokenizer({}, simulator);

  simulator.control = tokenizer;
  tokenizer.state = PARSE5_MODES[start.mode];
  tokenizer.lastStartTagName = start.lastStartTagName;
  tokenizer.inForeignNode = start.foreign;
  try {
    tokenizer.write(html, true);
  } catch (error) {
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }

  return simulator.tokens;
};

interface Tally {
  compared: number;
  parse5Throws: number;
  entitiesBug: number;
  diffs: string[];
  /** Inputs compared again after the surrogate repair. */
  repaired: number;
}

/**
 * Compares every input. Inputs both tokenizers throw on are compared again
 * after the repair Blok's callers apply, so the rest of them is still checked.
 */
const compare = (inputs: string[], start: Start): Tally => {
  const tally = compareOnce(inputs, start);
  const repaired = compareOnce(repairedInputs.splice(0), start);

  return {
    compared: tally.compared + repaired.compared,
    parse5Throws: tally.parse5Throws + repaired.parse5Throws,
    entitiesBug: tally.entitiesBug + repaired.entitiesBug,
    diffs: [...tally.diffs, ...repaired.diffs.map((diff) => `after repair: ${diff}`)],
    repaired: repaired.compared,
  };
};

const repairedInputs: string[] = [];

const compareOnce = (inputs: string[], start: Start): Tally => {
  const tally: Tally = { compared: 0, parse5Throws: 0, entitiesBug: 0, diffs: [], repaired: 0 };

  inputs.forEach((html) => {
    const actual = ours(html, start);
    const expected = theirs(html, start);

    if (actual === null || expected === null) {
      if (actual === null && expected === null) {
        tally.parse5Throws += 1;
        repairedInputs.push(repairSurrogates(html));
      } else {
        tally.diffs.push(`${actual === null ? 'only ours' : 'only parse5'} throws ${JSON.stringify(html.slice(0, 200))}`);
        tally.compared += 1;
      }

      return;
    }

    if (actual.mixed.length > 0) {
      tally.diffs.push(`mixed kinds ${JSON.stringify(html.slice(0, 200))}: ${actual.mixed.join(', ')}`);
    } else if (JSON.stringify(actual.tokens) !== JSON.stringify(expected)) {
      if (hitsEntitiesBug(html)) {
        tally.entitiesBug += 1;

        return;
      }
      tally.diffs.push(JSON.stringify(html.slice(0, 200)));
    }
    tally.compared += 1;
  });

  return tally;
};

/** Printed so a run shows how much was compared and what was skipped. */
const report = (name: string, tally: Tally): void => {
  console.info(`${name}: ${tally.compared} compared, ${tally.parse5Throws} both threw (${tally.repaired} compared after repair), ${tally.entitiesBug} skipped (entities 8.0.0 bug), ${tally.diffs.length} diffs`);
};

const FUZZ_SEEDS = 20_000;
const fuzz = Array.from({ length: FUZZ_SEEDS }, (_, seed) => fuzzHtml(seed));

// Generous: these run thousands of inputs and share the machine with other jobs.
const SLOW = { timeout: 120_000 };

describe('Tokenizer against parse5', SLOW, () => {
  it('matches on real documents', () => {
    const tally = compare(realDocuments().map((doc) => doc.html), DATA);

    report('real documents', tally);
    expect(tally.diffs).toEqual([]);
    expect(tally.compared).toBeGreaterThan(10);
    expect(tally.entitiesBug).toBe(0);
  });

  it('matches on every tree-construction input', () => {
    const inputs = treeConstructionInputs();
    const tally = compare(inputs, DATA);

    report('tree-construction inputs', tally);
    expect(tally.diffs).toEqual([]);
    expect(tally.compared - tally.repaired + tally.parse5Throws + tally.entitiesBug).toBe(inputs.length);
    expect(tally.entitiesBug).toBe(0);
  });

  it('matches on stored fields', () => {
    const inputs = storedFields();
    const tally = compare(inputs, DATA);

    report('stored fields', tally);
    expect(tally.diffs).toEqual([]);
    expect(tally.compared - tally.repaired + tally.parse5Throws).toBe(inputs.length);
    expect(tally.entitiesBug).toBe(0);
  });

  it(`matches on ${FUZZ_SEEDS} fuzzed fragments`, () => {
    const tally = compare(fuzz, DATA);

    report('fuzz', tally);
    expect(tally.diffs).toEqual([]);
    expect(tally.compared - tally.repaired + tally.parse5Throws + tally.entitiesBug).toBe(FUZZ_SEEDS);
    expect(tally.repaired).toBe(tally.parse5Throws);
    expect(tally.entitiesBug).toBe(0);
  });

  it.each([
    { mode: TokenizerMode.RCDATA, lastStartTagName: 'textarea', foreign: false },
    { mode: TokenizerMode.RCDATA, lastStartTagName: 'title', foreign: false },
    { mode: TokenizerMode.RAWTEXT, lastStartTagName: 'style', foreign: false },
    { mode: TokenizerMode.SCRIPT_DATA, lastStartTagName: 'script', foreign: false },
    { mode: TokenizerMode.PLAINTEXT, lastStartTagName: 'plaintext', foreign: false },
    { mode: TokenizerMode.DATA, lastStartTagName: '', foreign: true },
    { mode: TokenizerMode.RCDATA, lastStartTagName: '', foreign: false },
  ])('matches when it starts in mode $mode after <$lastStartTagName> (foreign: $foreign)', (start) => {
    const inputs = [...treeConstructionInputs(), ...fuzz.slice(0, 3000)];
    const tally = compare(inputs, start);

    report(`mode ${start.mode} after <${start.lastStartTagName}> foreign ${String(start.foreign)}`, tally);
    expect(tally.diffs).toEqual([]);
    expect(tally.compared - tally.repaired + tally.parse5Throws).toBe(inputs.length);
    expect(tally.repaired).toBe(tally.parse5Throws);
    expect(tally.entitiesBug).toBe(0);
  });
});
