import { insideOf, tokenOf, type Grammar, type Highlighter } from '../engine';

// Converted from Prism 1.30.0 components/prism-markup.js. Keep regex literals byte-identical.
/**
 * Prism defines these two as hidden methods on `markup.tag`. They are plain
 * functions here; css and javascript call them to embed their grammar.
 */
export const addInlined = (hl: Highlighter, tagName: string, lang: string): void => {
  const { languages } = hl;
  const includedCdataInside: Grammar = {};

  includedCdataInside['language-' + lang] = {
    pattern: /(^<!\[CDATA\[)[\s\S]+?(?=\]\]>$)/i,
    lookbehind: true,
    inside: languages[lang]
  };
  includedCdataInside['cdata'] = /^<!\[CDATA\[|\]\]>$/i;

  const inside: Grammar = {
    'included-cdata': {
      pattern: /<!\[CDATA\[[\s\S]*?\]\]>/i,
      inside: includedCdataInside
    }
  };

  inside['language-' + lang] = {
    pattern: /[\s\S]+/,
    inside: languages[lang]
  };

  const def: Grammar = {};

  def[tagName] = {
    pattern: RegExp(/(<__[^>]*>)(?:<!\[CDATA\[(?:[^\]]|\](?!\]>))*\]\]>|(?!<!\[CDATA\[)[\s\S])*?(?=<\/__>)/.source.replace(/__/g, function () { return tagName; }), 'i'),
    lookbehind: true,
    greedy: true,
    inside: inside
  };

  hl.insertBefore('markup', 'cdata', def);
};

export const addAttribute = (hl: Highlighter, attrName: string, lang: string): void => {
  const { languages } = hl;
  const specialAttr = insideOf(languages.markup, 'tag')['special-attr'];

  if (!Array.isArray(specialAttr)) {
    throw new Error('markup tag has no special-attr list');
  }

  specialAttr.push({
    pattern: RegExp(
      /(^|["'\s])/.source + '(?:' + attrName + ')' + /\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))/.source,
      'i'
    ),
    lookbehind: true,
    inside: {
      'attr-name': /^[^\s=]+/,
      'attr-value': {
        pattern: /=[\s\S]+/,
        inside: {
          'value': {
            pattern: /(^=\s*(["']|(?!["'])))\S[\s\S]*(?=\2$)/,
            lookbehind: true,
            alias: [lang, 'language-' + lang],
            inside: languages[lang]
          },
          'punctuation': [
            {
              pattern: /^=/,
              alias: 'attr-equals'
            },
            /"|'/
          ]
        }
      }
    }
  });
};

export const define = (hl: Highlighter): void => {
  const { languages } = hl;

  languages.markup = {
    'comment': {
      pattern: /<!--(?:(?!<!--)[\s\S])*?-->/,
      greedy: true
    },
    'prolog': {
      pattern: /<\?[\s\S]+?\?>/,
      greedy: true
    },
    'doctype': {
      // https://www.w3.org/TR/xml/#NT-doctypedecl
      pattern: /<!DOCTYPE(?:[^>"'[\]]|"[^"]*"|'[^']*')+(?:\[(?:[^<"'\]]|"[^"]*"|'[^']*'|<(?!!--)|<!--(?:[^-]|-(?!->))*-->)*\]\s*)?>/i,
      greedy: true,
      inside: {
        'internal-subset': {
          pattern: /(^[^\[]*\[)[\s\S]+(?=\]>$)/,
          lookbehind: true,
          greedy: true,
          inside: null // see below
        },
        'string': {
          pattern: /"[^"]*"|'[^']*'/,
          greedy: true
        },
        'punctuation': /^<!|>$|[[\]]/,
        'doctype-tag': /^DOCTYPE/i,
        'name': /[^\s<>'"]+/
      }
    },
    'cdata': {
      pattern: /<!\[CDATA\[[\s\S]*?\]\]>/i,
      greedy: true
    },
    'tag': {
      pattern: /<\/?(?!\d)[^\s>\/=$<%]+(?:\s(?:\s*[^\s>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s>]))|(?=[\s/>])))+)?\s*\/?>/,
      greedy: true,
      inside: {
        'tag': {
          pattern: /^<\/?[^\s>\/]+/,
          inside: {
            'punctuation': /^<\/?/,
            'namespace': /^[^\s>\/:]+:/
          }
        },
        'special-attr': [],
        'attr-value': {
          pattern: /=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+)/,
          inside: {
            'punctuation': [
              {
                pattern: /^=/,
                alias: 'attr-equals'
              },
              {
                pattern: /^(\s*)["']|["']$/,
                lookbehind: true
              }
            ]
          }
        },
        'punctuation': /\/?>/,
        'attr-name': {
          pattern: /[^\s>\/]+/,
          inside: {
            'namespace': /^[^\s>\/:]+:/
          }
        }
  
      }
    },
    'entity': [
      {
        pattern: /&[\da-z]{1,8};/i,
        alias: 'named-entity'
      },
      /&#x?[\da-f]{1,8};/i
    ]
  };
  
  insideOf(insideOf(languages.markup, 'tag'), 'attr-value')['entity'] =
    languages.markup['entity'];
  tokenOf(insideOf(languages.markup, 'doctype'), 'internal-subset').inside = languages.markup;

  // Plugin to make entity title show the real entity, idea by Roman Komarov
  hl.hooks.add('wrap', function (env) {
    if (env.type === 'entity') {
      // eslint-disable-next-line no-param-reassign -- wrap hooks add attributes through env
      env.attributes['title'] = env.content.replace(/&amp;/, '&');
    }
  });

  languages.html = languages.markup;
  languages.mathml = languages.markup;
  languages.svg = languages.markup;

  languages.xml = hl.extend('markup', {});
  languages.ssml = languages.xml;
  languages.atom = languages.xml;
  languages.rss = languages.xml;
};
