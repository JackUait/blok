/**
 * HTML manipulation utilities
 */

/**
 * Strips fake background wrapper elements from HTML content.
 * These elements are used by the inline toolbar for visual selection highlighting
 * and should not be persisted in saved data.
 * @param html - HTML content that may contain fake background elements
 * @returns HTML content with fake background wrappers removed but their content preserved
 */
export const stripFakeBackgroundElements = (html: string): string => {
  if (!html || !html.includes('data-blok-fake-background')) {
    return html;
  }

  const tempDiv = document.createElement('div');

  tempDiv.innerHTML = html;

  const fakeBackgrounds = tempDiv.querySelectorAll('[data-blok-fake-background="true"]');

  fakeBackgrounds.forEach((element) => {
    const parent = element.parentNode;

    if (!parent) {
      return;
    }

    while (element.firstChild) {
      parent.insertBefore(element.firstChild, element);
    }

    parent.removeChild(element);
  });

  return tempDiv.innerHTML;
};
