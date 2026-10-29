import { insideOf, type Highlighter } from '../engine';
import { addAttribute, addInlined } from './markup';

// Converted from Prism 1.30.0 components/prism-css.js. Keep regex literals byte-identical.
export const define = (hl: Highlighter): void => {
  const { languages } = hl;


  const string = /(?:"(?:\\(?:\r\n|[\s\S])|[^"\\\r\n])*"|'(?:\\(?:\r\n|[\s\S])|[^'\\\r\n])*')/;

  /*
   * Not Prism: atrule and selector are not greedy, so every earlier start in
   * the text was tried and failed before this one. If the text up to the end
   * of this start's first step is a run of steps from an earlier start, this
   * start's loop is that start's loop from here on and fails too, so skip it.
   * Each start used to scan to the end of the line. At least one step keeps a
   * start from matching itself. Do not use this on a greedy pattern: Prism
   * runs those from mid-text, where the earlier start was never tried.
   */
  const notMidRun = (start: string, step: string): string => '(?<!' + start + '(?:' + step + ')+?)';
  const atruleStep = /[^;{\s"']|\s+(?!\s)/.source + '|' + string.source;
  const selectorStep = /[^{};"'\s]|\s+(?![\s{])/.source + '|' + string.source;

  languages.css = {
    'comment': /\/\*[\s\S]*?\*\//,
    'atrule': {
      pattern: RegExp('@[\\w-]' + notMidRun('@[\\w-]', atruleStep) + '(?:' + atruleStep + ')*?' + /(?:;|(?=\s*\{))/.source),
      inside: {
        'rule': /^@[\w-]+/,
        'selector-function-argument': {
          pattern: /(\bselector\s*\(\s*(?![\s)]))(?:[^()\s]|\s+(?![\s)])|\((?:[^()]|\([^()]*\))*\))+(?=\s*\))/,
          lookbehind: true,
          alias: 'selector'
        },
        'keyword': {
          pattern: /(^|[^\w-])(?:and|not|only|or)(?![\w-])/,
          lookbehind: true
        }
        // See rest below
      }
    },
    'url': {
      // https://drafts.csswg.org/css-values-3/#urls
      pattern: RegExp('\\burl\\((?:' + string.source + '|' + /(?:[^\\\r\n()"']|\\[\s\S])*/.source + ')\\)', 'i'),
      greedy: true,
      inside: {
        'function': /^url/i,
        'punctuation': /^\(|\)$/,
        'string': {
          pattern: RegExp('^' + string.source + '$'),
          alias: 'url'
        }
      }
    },
    'selector': {
      pattern: RegExp('(^|[{}\\s])[^{}\\s]' + notMidRun('(?:^|[{}\\s])[^{}\\s]', selectorStep) + '(?:' + selectorStep + ')*(?=\\s*\\{)'),
      lookbehind: true
    },
    'string': {
      pattern: string,
      greedy: true
    },
    'property': {
      pattern: /(^|[^-\w\xA0-\uFFFF])(?!\s)[-_a-z\xA0-\uFFFF](?:(?!\s)[-\w\xA0-\uFFFF])*(?=\s*:)/i,
      lookbehind: true
    },
    'important': /!important\b/i,
    'function': {
      pattern: /(^|[^-a-z0-9])[-a-z0-9]+(?=\()/i,
      lookbehind: true
    },
    'punctuation': /[(){};:,]/
  };

  insideOf(languages.css, 'atrule').rest = languages.css;

  if (languages.markup) {
    addInlined(hl, 'style', 'css');
    addAttribute(hl, 'style', 'css');
  }

};
