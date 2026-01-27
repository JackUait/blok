/**
 * Sidebar sections for the Recipes page
 */

export interface RecipeSidebarLink {
  id: string;
  label: string;
}

export interface RecipeSidebarSection {
  title: string;
  links: RecipeSidebarLink[];
}

export const SIDEBAR_SECTIONS: RecipeSidebarSection[] = [
  {
    title: 'Quick Reference',
    links: [
      { id: 'quick-tips', label: 'Quick Tips' },
      { id: 'keyboard-shortcuts', label: 'Keyboard Shortcuts' },
    ],
  },
  {
    title: 'Code Recipes',
    links: [
      { id: 'autosave', label: 'Autosave with Debouncing' },
      { id: 'events', label: 'Working with Events' },
      { id: 'custom-tool', label: 'Creating a Custom Tool' },
      { id: 'styling', label: 'Styling with Data Attributes' },
      { id: 'read-only', label: 'Read-Only Mode' },
      { id: 'localization', label: 'Localization' },
    ],
  },
];
