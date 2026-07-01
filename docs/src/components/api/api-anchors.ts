/** "blocks.clear()" -> "blocks-api-blocks-clear" */
export const generateMethodId = (sectionId: string, methodName: string): string => {
  const methodBase = methodName.split('(')[0];
  const cleanName = methodBase
    .replace(/[.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/-$/, '')
    .toLowerCase();
  return `${sectionId}-${cleanName}`;
};

/** "isReady" -> "core-prop-isready" */
export const generatePropertyId = (sectionId: string, propName: string): string => {
  const cleanName = propName.replace(/[.]+/g, '-').replace(/-+/g, '-').toLowerCase();
  return `${sectionId}-prop-${cleanName}`;
};

/** "holder" -> "config-holder" */
export const generateOptionId = (sectionId: string, optionName: string): string =>
  `${sectionId}-${optionName.toLowerCase()}`;
