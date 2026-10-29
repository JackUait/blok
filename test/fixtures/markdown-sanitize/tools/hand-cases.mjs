// Raw HTML the way GitHub READMEs write it. Each string is a Markdown
// document; harvest.mjs keeps the html blocks the parser finds in it.
export const HAND_CASES = [
  // centred logos and headers
  '<p align="center">\n  <img src="./assets/logo.svg" alt="Logo" width="120">\n</p>',
  '<p align="center"><img src="https://raw.githubusercontent.com/owner/repo/main/logo.png" alt="Project logo" width="200" height="200"/></p>',
  '<p align="center">\n  <a href="https://example.com">\n    <img src="docs/logo.png" alt="Example" width="300">\n  </a>\n</p>',
  '<h1 align="center">My Project</h1>',
  '<h1 align="center">\n  <img src="logo.png" width="64"><br>\n  My Project\n</h1>',
  '<h3 align="center">A fast, small editor</h3>',
  '<div align="center">\n\n# Title\n\n**Bold tagline**\n\n</div>',
  '<div align="center">\n  <h1>Awesome Tool</h1>\n  <p>Does one thing well.</p>\n</div>',
  '<div align=center>\n<img src=logo.png width=100>\n</div>',
  '<div align="center">\n  <sub>Built with ❤︎ by <a href="https://github.com/someone">someone</a> and <a href="https://github.com/owner/repo/graphs/contributors">contributors</a></sub>\n</div>',

  // badge rows
  '<p align="center">\n  <a href="https://www.npmjs.com/package/pkg"><img src="https://img.shields.io/npm/v/pkg.svg" alt="npm version"></a>\n  <a href="https://github.com/owner/repo/actions"><img src="https://github.com/owner/repo/actions/workflows/ci.yml/badge.svg" alt="CI"></a>\n  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>\n</p>',
  '<a href="https://codecov.io/gh/owner/repo"><img src="https://codecov.io/gh/owner/repo/branch/main/graph/badge.svg?token=ABC" alt="codecov"/></a>',
  '<a href="https://discord.gg/abc"><img alt="Discord" src="https://img.shields.io/discord/123?label=chat&logo=discord&style=flat-square"></a> <a href="https://twitter.com/x"><img alt="Twitter" src="https://img.shields.io/twitter/follow/x?style=social"></a>',
  '<img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node &gt;= 18">',

  // details / summary
  '<details>\n<summary>Click to expand</summary>\n\nHidden **markdown** here.\n\n</details>',
  '<details open>\n  <summary><b>Table of contents</b></summary>\n  <ol>\n    <li><a href="#install">Install</a></li>\n    <li><a href="#usage">Usage</a></li>\n  </ol>\n</details>',
  '<details>\n<summary>Screenshots</summary>\n<img src="docs/screen1.png" width="400">\n<img src="docs/screen2.png" width="400">\n</details>',
  '</details>',
  '<summary>Orphan summary</summary>',

  // picture for dark mode
  '<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">\n  <source media="(prefers-color-scheme: light)" srcset="docs/logo-light.svg">\n  <img alt="Logo" src="docs/logo-light.svg" width="250">\n</picture>',
  '<p align="center">\n  <picture>\n    <source media="(prefers-color-scheme: dark)" srcset="https://example.com/dark.png">\n    <img src="https://example.com/light.png" alt="Banner">\n  </picture>\n</p>',
  '<img src="small.png" srcset="small.png 1x, large.png 2x" alt="Responsive">',

  // tables
  '<table>\n  <tr>\n    <th align="left">Name</th>\n    <th align="right">Size</th>\n  </tr>\n  <tr>\n    <td>core</td>\n    <td align="right">12 kB</td>\n  </tr>\n</table>',
  '<table>\n<thead><tr><th colspan="2">Platforms</th></tr></thead>\n<tbody>\n<tr><td rowspan="2">Desktop</td><td>macOS</td></tr>\n<tr><td>Windows</td></tr>\n</tbody>\n</table>',
  '<table>\n  <tr>\n    <td align="center" width="33%"><img src="a.png" width="100"><br><sub><b>Alice</b></sub></td>\n    <td align="center" width="33%"><img src="b.png" width="100"><br><sub><b>Bob</b></sub></td>\n  </tr>\n</table>',
  '<table><caption>Results</caption><tfoot><tr><td>Total</td></tr></tfoot></table>',
  '<table border="1" cellpadding="4" style="width:100%"><tr><td bgcolor="#eee">old attrs</td></tr></table>',

  // inline-ish formatting at block level
  '<p>Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> to open the palette.</p>',
  '<kbd>Cmd</kbd>+<kbd>K</kbd>',
  '<p>H<sub>2</sub>O and E = mc<sup>2</sup></p>',
  '<p>Line one<br/>Line two<br>Line three<br />Line four</p>',
  '<br/>',
  '<br>',
  '<hr>',
  '<p><abbr title="HyperText Markup Language">HTML</abbr> is <mark>fine</mark>, <del>old</del> <ins>new</ins>, <s>gone</s>, <u>under</u>, <small>tiny</small>.</p>',
  '<p><samp>output</samp> and <code>code</code></p>',
  '<pre><code>npm install pkg\n  indented line\n</code></pre>',
  '<blockquote>\n  <p>Quote with <em>emphasis</em> and <strong>strong</strong>.</p>\n</blockquote>',

  // links and anchors
  '<a href="#installation">Jump to install</a>',
  '<a name="top"></a>',
  '<a id="usage"></a>',
  '<h2 id="api"><a href="#api" aria-hidden="true" class="anchor">#</a>API</h2>',
  '<a href="docs/GUIDE.md">Guide</a>',
  '<a href="../CONTRIBUTING.md">Contributing</a>',
  '<a href="/LICENSE">License</a>',
  '<a href="mailto:team@example.com">Email us</a>',
  '<a href="https://example.com" target="_self" rel="opener">Explicit target</a>',
  '<a href="//cdn.example.com/x.js">Protocol relative</a>',
  '<a href="https://example.com/path?query=1&amp;other=2#frag">Entities in URL</a>',
  '<a title="No href">Just a title</a>',

  // images
  '<img width="100" height="50" alt="Sized" src="img/sized.png">',
  '<img src="./screenshot.gif" alt="">',
  '<img src="docs/assets/demo.png" alt="Demo" title="Demo screenshot" align="right" width="40%">',
  '<img alt="no src">',

  // lists
  '<ol start="3">\n  <li>Third</li>\n  <li>Fourth</li>\n</ol>',
  '<ul>\n  <li><a href="https://a.example">A</a></li>\n  <li><a href="https://b.example">B</a></li>\n</ul>',
  '<dl>\n  <dt>Term</dt>\n  <dd>Definition</dd>\n</dl>',

  // figure
  '<figure>\n  <img src="chart.png" alt="Chart">\n  <figcaption>Fig. 1 — throughput</figcaption>\n</figure>',

  // comments
  '<!-- This comment is hidden -->',
  '<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->\n<!-- prettier-ignore-start -->',
  '<p>Before<!-- inline comment -->after</p>',

  // emoji, entities and whitespace
  '<p align="center">🚀 Fast · 🔒 Safe · 📦 Small</p>',
  '<p>&copy; 2026 Example &mdash; all rights reserved &nbsp;&amp;&nbsp; &lt;3 &#x1F600; &#169;</p>',
  '<p>\n\n  spaced   text\n\n</p>',
  '\n<div>\n\n</div>\n',
  '<div>\t<span>tab</span>\t</div>',

  // tags outside the allowlist that READMEs still use
  '<center>Old school centring</center>',
  '<font color="red">Red text</font>',
  '<span style="color: red">Styled span</span>',
  '<div class="note" id="n1" data-foo="bar">Classes and data attributes</div>',
  '<video src="demo.mp4" controls width="400"></video>',
  '<iframe width="560" height="315" src="https://www.youtube.com/embed/abc" frameborder="0" allowfullscreen></iframe>',
  '<p align="center"><a href="https://www.youtube.com/watch?v=abc"><img src="https://img.youtube.com/vi/abc/0.jpg" alt="Watch the video"></a></p>',
];
