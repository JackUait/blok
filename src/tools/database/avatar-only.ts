/** Notion's list and timeline show a person as the avatar alone; the name stays for screen readers. */
export const showAvatarsOnly = (cell: HTMLElement): void => {
  cell.querySelectorAll('[data-blok-database-person-chip]').forEach((chip) => {
    chip.childNodes.forEach((node) => {
      if (node.nodeType !== Node.TEXT_NODE) return;
      const name = document.createElement('span');

      name.setAttribute('data-blok-database-sr-only', '');
      name.textContent = node.textContent;
      node.replaceWith(name);
    });
  });
};
