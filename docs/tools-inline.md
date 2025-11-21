# Tools for the Inline Toolbar

Similar with [Tools](tools.md) represented Blocks, you can create Tools for the Inline Toolbar. It will work with
selected fragment of text. The simplest example is `bold` or `italic` Tools.

## Base structure

First of all, Tool's class should have a `isInline` property (static getter) set as `true`.

After that Inline Tool should implement the `render` method.

- `render()` — returns Tool's visual representation and logic

Also, you can provide optional methods:

- `sanitize()` — sanitizer configuration

At the constructor of Tool's class exemplar you will accept an object with the [API](api.md) as a parameter.

---

### render()

Method that returns Menu Config for the Inline Toolbar

#### Parameters

Method does not accept any parameters

#### Return value

type | description |
-- | -- |
`MenuConfig` | configuration object for the tool's button and behavior |

#### Example

```typescript
render(): MenuConfig {
  return {
    icon: '<svg>...</svg>',
    title: 'Bold',
    isActive: () => {
        // check if current selection is bold
    },
    onActivate: () => {
        // toggle bold state
    }
  };
}
```

---

### static get sanitize()

We recommend to specify the Sanitizer config that corresponds with inline tags that is used by your Tool.
In that case, your config will be merged with sanitizer configuration of Block Tool
that is using the Inline Toolbar with your Tool.

Example:

If your Tool wraps selected text with `<b>` tag, the sanitizer config should looks like this:

```js
static get sanitize() {
  return {
    b: {} // {} means clean all attributes. true — leave all attributes
  }
}
```

Read more about Sanitizer configuration at the [Tools#sanitize](tools.md#sanitize)

### Specifying a title

You can pass your Tool's title via `title` static getter. It can be used, for example, in the Tooltip with
icon description that appears by hover.

```ts
export default class BoldInlineTool implements InlineTool {
  /**
   * Specifies Tool as Inline Toolbar Tool
   *
   * @return {boolean}
   */
  public static isInline = true;

  /**
   * Title for hover-tooltip
   */
  public static title: string = 'Bold';

  // ... other methods
}
```
