# Editor.js specs

This document will describe various test cases of the editor.js functionality. Features will be organized by modules. Cases covered by tests should be marked by the checkmark.

## Configuration

- [x] Zero configuration
  - [x] Editor.js should be initialized on the element with the default `editorjs` id.
  - [x] Editor.js should throw an error in case when there is no element with `editorjs` id.
  - [x] Editor.js should be initialized with the Paragraph tool only.
  - [x] The Inline Toolbar of the Paragraph tool should contain all default Inline Tools - `bold`, `italic`, `link`.

- [x] `holder` property
  - [x] Editor.js should be initialized on the element with passed via `holder` property.
  - [x] Editor.js should throw an error if passed `holder` value is not an Element node.

- [x] `autofocus` property
  - [x] With the empty editor
    - [x] If `true` passed, the caret should be placed to the first empty block.
    - [x] If `false` passed, the caret shouldn't be placed anywhere.
    - [x] If omitted, the caret shouldn't be placed anywhere.
  - [x] With the not-empty editor
    - [x] If `true` passed, the caret should be placed to the end of the last block.
    - [x] If `false` passed, the caret shouldn't be placed anywhere.
    - [x] If omitted, the caret shouldn't be placed anywhere.

- [x] `placeholder` property
  - [x] With the empty editor
    - [x] If `string` passed, the string should be placed as a placeholder to the first empty block only.
    - [x] If `false` passed, the first empty block should be placed without a placeholder.
    - [x] If omitted, the first empty block should be placed without a placeholder.

- [x] `minHeight` property
  - [x] If `number` passed, the height of the editor's bottom area from the last Block should be the `number`.
  - [x] If omitted the height of editor's bottom area from the last Block should be the default `300`.

- [x] `logLevel` property
  - [x] If `VERBOSE` passed, the editor should output all messages to the console.
  - [x] If `INFO` passed, the editor should output info and debug messages to the console.
  - [x] If `WARN` passed, the editor should output only warning messages to the console.
  - [x] If `ERROR` passed, the editor should output only error messages to the console.
  - [x] If omitted, the editor should output all messages to the console.

- [x] `defaultBlock` property
  - [x] If `string` passed
    - [x] If passed `string` in the `tools` option, the passed tool should be used as the default tool.
    - [x] If passed `string` not in the `tools` option, the Paragraph tool should be used as the default tool.
  - [x] If omitted the Paragraph tool should be used as default tool.

- [x] `sanitizer` property
  - [x] If `object` passed
    - [x] The Editor.js should clean the HTML tags according to mentioned configuration.
  - [x] If omitted the Editor.js should be initialized with the default `sanitizer` configuration, which allows the tags like `paragraph`, `anchor`, and `bold` for cleaning HTML.

- [x] `tools` property
  - [x] If omitted,the Editor.js should be initialized with the Paragraph tool only.
  - [x] If `object` passed
    - [x] Editor.js should be initialized with all the passed tools.
    - [x] The keys of the object should be represented as `type` fields for corresponded blocks in output JSON
    - [x] If value is a JavaScript class, the class should be used as a tool
    - [x] If value is an `object`
      - [x] Checking the `class` property
        - [x] If omitted, the tool should be skipped with a warning in a console.
        - [x] If existed, the value of the `class` property should be used as a tool
      - [x] Checking the `config` property
        - [x] If `object` passed Editor.js should initialize `tool` and pass this object as `config` parameter of the tool's constructor
      - [x] Checking the `shortcut` property
        - [x] If `string` passed Editor.js should append the `tool` when such keys combination executed.
      - [x] Checking the `inlineToolbar` property
        - [x] If `true` passed, the Editor.js should show the Inline Toolbar for this tool with [common](https://editorjs.io/configuration#inline-toolbar-order) settings.
        - [x] If `false` passed, the Editor.js should not show the Inline Toolbar for this tool.
        - [x] If `array` passed, the Editor.js should show the Inline Toolbar for this tool with a passed list of tools and their order.
        - [x] If omitted, the Editor.js should not show the Inline Toolbar for this tool.
      - [x] Checking the `toolbox` property
        - [x] If it contains `title`, this title should be used as a tool title
        - [x] If it contains `icon`, this HTML code (maybe SVG) should be used as a tool icon

- [x] `onReady` property
  - [x] If `function` passed, the Editor.js should call the `function` when it's ready to work.
  - [x] If omitted, the Editor.js should be initialized with the `tools` only.

- [x] `onChange` property
  - [x] If `function` passed,the Editor.js should call the `function` when something changed in Editor.js DOM.
  - [x] If omitted, the Editor.js should be initialized with the `tools` only.

- [x] `data` property
  - [x] If omitted
    - [x] the Editor.js should be initialized with the `tools` only.
    - [x] the Editor.js should be empty.
  - [x] If `object` passed
    - [x] Checking the `blocks` property
      - [x] If `array` of `object` passed,
        - [x] for each `object`
          - [x] Checking the `type` and `data` property
            - [x] the Editor.js should be initialize with `block` of class `type`
            - [ ] If `type` not present in `tools`, the Editor.js should throw an error.
      - [x] If omitted
        - [x] the Editor.js should be initialized with the `tools` only.
        - [x] the Editor.js should be empty.

- [x] `readOnly` property
  - [x] If `true` passed,
    - [x] If any `tool` have not readOnly getter defined,The Editor.js should throw an error.
    - [x] otherwise, the Editor.js should be initialize with readOnly mode.
  - [x] If `false` passed,the Editor.js should be initialized with the `tools` only.
  - [x] If omitted,the Editor.js should be initialized with the `tools` only.

- [ ] `i18n` property
