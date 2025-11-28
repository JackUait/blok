const ELEMENT_DELIMITER = '__';
const MODIFIER_DELIMITER = '--';

/**
 * Utility function that allows to construct class names from block and element names
 * @example bem('blok-popover)() -> 'blok-popover'
 * @example bem('blok-popover)('container') -> 'blok-popover__container'
 * @example bem('blok-popover)('container', 'hidden') -> 'blok-popover__container--hidden'
 * @example bem('blok-popover)(null, 'hidden') -> 'blok-popover--hidden'
 * @param blockName - string with block name
 */
export const bem = (blockName: string) => {
  /**
   * @param elementName - string with element name
   * @param modifier - modifier to be appended
   */
  return (elementName?: string | null, modifier?: string) => {
    const className = [blockName, elementName]
      .filter(x => !!x)
      .join(ELEMENT_DELIMITER);

    return [className, modifier]
      .filter(x => !!x)
      .join(MODIFIER_DELIMITER);
  };
};
