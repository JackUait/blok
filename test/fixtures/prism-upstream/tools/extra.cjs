// Embedded languages: markup must carry css and javascript in every host.
const inline = '<style>a { color: red }</style>\n<p onclick="go(1)" style="margin: 0">&amp; x</p>\n<script>const a = 1;</script>';
module.exports = [
  ...['html', 'xml', 'markdown'].map((lang) => ({ lang, source: 'blok:inline', code: inline })),
  { lang: 'php', source: 'blok:inline', code: '<?php echo 1; ?>\n' + inline },
  { lang: 'markdown', source: 'blok:inline', code: '---\ntitle: x\n---\n# H\n\n```js\nconst a = 1;\n```\n\n```python\nx = 1\n```' },
  { lang: 'graphql', source: 'blok:inline', code: '"""\n**Bold** description\n"""\ntype Q { a: Int }' },
  // Hook-driven output: graphql mutation aliases, php placeholders, C# interpolation.
  { lang: 'graphql', source: 'blok:hooks', code: 'mutation Foo($a: Int, $b: [String!]) { likeStory(storyID: $a, other: $b, c: $d) { story { likeCount } } }' },
  { lang: 'graphql', source: 'blok:hooks', code: 'mutation Foo($a: Int) { x(y: $a' },
  { lang: 'php', source: 'blok:hooks', code: '<div><?php echo "x"; ?><b>___PHP0___</b><?= $y ?></div>' },
  { lang: 'php', source: 'blok:hooks', code: '<a href="<?php echo $u ?>">t</a> <?php /* c ?> */ $x = 1;' },
  { lang: 'csharp', source: 'blok:hooks', code: 'var s = $@"a {x:N2} {{ {(y ? "a" : "b")}"; [Obsolete("x")] class A<T> : B<List<int>> { }' },
  { lang: 'markdown', source: 'blok:hooks', code: '```js\nconst a = "&#x110000; &#1a;";\n```\n&amp; &#x26; &copy;' },
];
