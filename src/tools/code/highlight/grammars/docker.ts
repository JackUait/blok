import type { GrammarToken, Highlighter } from '../engine';

// Converted from Prism 1.30.0 components/prism-docker.js. Keep regex literals byte-identical.
export const define = (hl: Highlighter): void => {
  const { languages } = hl;

  // Many of the following regexes will contain negated lookaheads like `[ \t]+(?![ \t])`. This is a trick to ensure
  // that quantifiers behave *atomically*. Atomic quantifiers are necessary to prevent exponential backtracking.

  const spaceAfterBackSlash = /\\[\r\n](?:\s|\\[\r\n]|#.*(?!.))*(?![\s#]|\\[\r\n])/.source;
  // At least one space, comment, or line break
  const space = /(?:[ \t]+(?![ \t])(?:<SP_BS>)?|<SP_BS>)/.source
    .replace(/<SP_BS>/g, function () { return spaceAfterBackSlash; });

  const string = /"(?:[^"\\\r\n]|\\(?:\r\n|[\s\S]))*"|'(?:[^'\\\r\n]|\\(?:\r\n|[\s\S]))*'/.source;
  const option = /--[\w-]+=(?:<STR>|(?!["'])(?:[^\s\\]|\\.)+)/.source.replace(/<STR>/g, function () { return string; });

  const stringRule: GrammarToken = {
    pattern: RegExp(string),
    greedy: true
  };
  const commentRule: GrammarToken = {
    pattern: /(^[ \t]*)#.*/m,
    lookbehind: true,
    greedy: true
  };

  /**
   * @param {string} source
   * @param {string} flags
   * @returns {RegExp}
   */
  function re(source: string, flags: string): RegExp {
    const expanded = source
      .replace(/<OPT>/g, function () { return option; })
      .replace(/<SP>/g, function () { return space; });

    return RegExp(expanded, flags);
  }

  languages.docker = {
    'instruction': {
      pattern: /(^[ \t]*)(?:ADD|ARG|CMD|COPY|ENTRYPOINT|ENV|EXPOSE|FROM|HEALTHCHECK|LABEL|MAINTAINER|ONBUILD|RUN|SHELL|STOPSIGNAL|USER|VOLUME|WORKDIR)(?=\s)(?:\\.|[^\r\n\\])*(?:\\$(?:\s|#.*$)*(?![\s#])(?:\\.|[^\r\n\\])*)*/im,
      lookbehind: true,
      greedy: true,
      inside: {
        'options': {
          pattern: re(/(^(?:ONBUILD<SP>)?\w+<SP>)<OPT>(?:<SP><OPT>)*/.source, 'i'),
          lookbehind: true,
          greedy: true,
          inside: {
            'property': {
              pattern: /(^|\s)--[\w-]+/,
              lookbehind: true
            },
            'string': [
              stringRule,
              {
                pattern: /(=)(?!["'])(?:[^\s\\]|\\.)+/,
                lookbehind: true
              }
            ],
            'operator': /\\$/m,
            'punctuation': /=/
          }
        },
        'keyword': [
          {
            // https://docs.docker.com/engine/reference/builder/#healthcheck
            pattern: re(/(^(?:ONBUILD<SP>)?HEALTHCHECK<SP>(?:<OPT><SP>)*)(?:CMD|NONE)\b/.source, 'i'),
            lookbehind: true,
            greedy: true
          },
          {
            // https://docs.docker.com/engine/reference/builder/#from
            pattern: re(/(^(?:ONBUILD<SP>)?FROM<SP>(?:<OPT><SP>)*(?!--)[^ \t\\]+<SP>)AS/.source, 'i'),
            lookbehind: true,
            greedy: true
          },
          {
            // https://docs.docker.com/engine/reference/builder/#onbuild
            pattern: re(/(^ONBUILD<SP>)\w+/.source, 'i'),
            lookbehind: true,
            greedy: true
          },
          {
            pattern: /^\w+/,
            greedy: true
          }
        ],
        'comment': commentRule,
        'string': stringRule,
        'variable': /\$(?:\w+|\{[^{}"'\\]*\})/,
        'operator': /\\$/m
      }
    },
    'comment': commentRule
  };

  languages.dockerfile = languages.docker;
};
