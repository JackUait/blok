import type { Highlighter } from '../engine';

// Converted from Prism 1.30.0 components/prism-yaml.js. Keep regex literals byte-identical.
export const define = (hl: Highlighter): void => {
  const { languages } = hl;

  // https://yaml.org/spec/1.2/spec.html#c-ns-anchor-property
  // https://yaml.org/spec/1.2/spec.html#c-ns-alias-node
  const anchorOrAlias = /[*&][^\s[\]{},]+/;
  // https://yaml.org/spec/1.2/spec.html#c-ns-tag-property
  const tag = /!(?:<[\w\-%#;/?:@&=+$,.!~*'()[\]]+>|(?:[a-zA-Z\d-]*!)?[\w\-%#;/?:@&=+$.~*'()]+)?/;
  // https://yaml.org/spec/1.2/spec.html#c-ns-properties(n,c)
  const properties = '(?:' + tag.source + '(?:[ \t]+' + anchorOrAlias.source + ')?|'
    + anchorOrAlias.source + '(?:[ \t]+' + tag.source + ')?)';
  // https://yaml.org/spec/1.2/spec.html#ns-plain(n,c)
  // This is a simplified version that doesn't support "#" and multiline keys
  // All these long scarry character classes are simplified versions of YAML's characters
  const plainChar = /[^\s\x00-\x08\x0e-\x1f,[\]{}\x7f-\x84\x86-\x9f\ud800-\udfff\ufffe\uffff]/.source;
  const plainFirst = /(?:[^\s\x00-\x08\x0e-\x1f!"#%&'*,\-:>?@[\]`{|}\x7f-\x84\x86-\x9f\ud800-\udfff\ufffe\uffff]|[?:-]<PLAIN>)/.source
    .replace(/<PLAIN>/g, function () { return plainChar; });
  const plainStep = /[ \t]*(?:(?![#:])<PLAIN>|:<PLAIN>)/.source
    .replace(/<PLAIN>/g, function () { return plainChar; });
  const string = /"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'/.source;

  /*
   * Not Prism: Prism's plainKey is plainFirst then any number of plainSteps.
   * Each start in a run like a::a:: scanned to the end of the line. If an
   * earlier start's steps reach the end of this start's first step, this
   * start's loop is that start's loop from there on, so it fails too and is
   * skipped. A `:` always pairs with the next char, so the earlier steps may
   * instead stop one char short on a `:` and meet this start again after the
   * colons. The earlier start must come before this attempt's prefix char, or
   * it was never tried: the `\1\2` check pins its steps to cross this
   * attempt's own prefix, else `- &a-b key:` loses its key. Group 1 is the
   * engine's lookbehind and group 2 the first step, so add no other groups.
   */
  const keyPrefix = /(?:^|[:\-,[{\r\n?])[ \t]*(?:<<prop>>[ \t]+)?/.source.replace(/<<prop>>/g, function () { return properties; });
  /*
   * Not Prism: an anchor right after a prefix char inside an earlier anchor,
   * as in &a-&a-&a, ends where that anchor ends and is followed by the same
   * key, so the earlier attempt already failed with it. Each one used to scan
   * the rest of the run. A tag is not skipped: the earlier anchor swallows it.
   */
  const anchorNotMidRun = /(?<!(?:^|[:\-,[{\r\n?])[ \t]*[*&][^\s[\]{},]*?(?=[*&]))/.source;
  const plainKey = '(' + plainFirst + ')(?<!' + keyPrefix + plainFirst + '(?:' + plainStep + ')*?(?=[ \\t]*:?\\1\\2)(?:(?:' + plainStep + ')+?|(?:' + plainStep + ')*?:(?=:*(?![#:])' + plainChar + ')))(?:' + plainStep + ')*';

  /**
   *
   * @param {string} value
   * @param {string} [flags]
   * @returns {RegExp}
   */
  function createValuePattern(value: string, flags?: string): RegExp {
    const mFlags = (flags || '').replace(/m/g, '') + 'm'; // add m flag
    const pattern = /([:\-,[{]\s*(?:\s<<prop>>[ \t]+)?)(?:<<value>>)(?=[ \t]*(?:$|,|\]|\}|(?:[\r\n]\s*)?#))/.source
      .replace(/<<prop>>/g, function () { return properties; }).replace(/<<value>>/g, function () { return value; });
    return RegExp(pattern, mFlags);
  }

  languages.yaml = {
    'scalar': {
      pattern: RegExp(/([\-:]\s*(?:\s<<prop>>[ \t]+)?[|>])[ \t]*(?:((?:\r?\n|\r)[ \t]+)\S[^\r\n]*(?:\2[^\r\n]+)*)/.source
        .replace(/<<prop>>/g, function () { return properties; })),
      lookbehind: true,
      alias: 'string'
    },
    'comment': /#.*/,
    'key': {
      pattern: RegExp(/((?:^|[:\-,[{\r\n?])[ \t]*(?:<<inrun>><<prop>>[ \t]+)?)<<key>>(?=\s*:\s)/.source
        .replace(/<<inrun>>/g, function () { return anchorNotMidRun; })
        .replace(/<<prop>>/g, function () { return properties; })
        .replace(/<<key>>/g, function () { return '(?:' + plainKey + '|' + string + ')'; })),
      lookbehind: true,
      greedy: true,
      alias: 'atrule'
    },
    'directive': {
      pattern: /(^[ \t]*)%.+/m,
      lookbehind: true,
      alias: 'important'
    },
    'datetime': {
      pattern: createValuePattern(/\d{4}-\d\d?-\d\d?(?:[tT]|[ \t]+)\d\d?:\d{2}:\d{2}(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d\d?(?::\d{2})?))?|\d{4}-\d{2}-\d{2}|\d\d?:\d{2}(?::\d{2}(?:\.\d*)?)?/.source),
      lookbehind: true,
      alias: 'number'
    },
    'boolean': {
      pattern: createValuePattern(/false|true/.source, 'i'),
      lookbehind: true,
      alias: 'important'
    },
    'null': {
      pattern: createValuePattern(/null|~/.source, 'i'),
      lookbehind: true,
      alias: 'important'
    },
    'string': {
      pattern: createValuePattern(string),
      lookbehind: true,
      greedy: true
    },
    'number': {
      pattern: createValuePattern(/[+-]?(?:0x[\da-f]+|0o[0-7]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|\.inf|\.nan)/.source, 'i'),
      lookbehind: true
    },
    'tag': tag,
    'important': anchorOrAlias,
    'punctuation': /---|[:[\]{}\-,|>?]|\.\.\./
  };

  languages.yml = languages.yaml;
};
