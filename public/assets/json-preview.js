/* eslint-env browser */

/**
 * Module to compose output JSON preview.
 *
 * @returns {{show: (output: object, holder: Element) => void}}
 */
const createPreview = () => {
  /**
   * Shows JSON in the pretty preview block.
   *
   * @param {object} output - data to render.
   * @param {Element} holder - element to populate with JSON.
   * @returns {void}
   */
  const show = (output, holder) => {
    const prettyJson = JSON.stringify(output, null, 4);
    const encodedJson = encodeHTMLEntities(prettyJson);
    const targetHolder = holder;

    targetHolder.innerHTML = stylize(encodedJson);
  };

  /**
   * Converts '>', '<', '&' symbols to entities.
   *
   * @param {string} value - text to convert.
   * @returns {string}
   */
  const encodeHTMLEntities = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  /**
   * Adds syntax highlighting spans to JSON markup.
   *
   * @param {string} value - HTML string to decorate.
   * @returns {string}
   */
  const stylize = (value) => value
    /** Stylize JSON keys */
    .replace(/"(\w+)"\s?:/g, '"<span class=sc_key>$1</span>" :')
    /** Stylize tool names */
    .replace(/"(paragraph|quote|list|header|link|code|image|delimiter|raw|checklist|table|embed|warning)"/g, '"<span class=sc_toolname>$1</span>"')
    /** Stylize HTML tags */
    .replace(/(&lt;[\/a-z]+(&gt;)?)/gi, '<span class=sc_tag>$1</span>')
    /** Stylize strings */
    .replace(/"([^"]+)"/gi, '"<span class=sc_attr>$1</span>"')
    /** Boolean/Null */
    .replace(/\b(true|false|null)\b/gi, '<span class=sc_bool>$1</span>');

  return { show };
};

const cPreview = createPreview();

if (typeof window !== 'undefined') {
  window.cPreview = cPreview;
}
