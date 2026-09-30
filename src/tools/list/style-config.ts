/**
 * Style Config - Static configurations for list item styles.
 */

import type { ToolboxConfig } from '../../../types';
import { IconListBulleted, IconListNumbered, IconListChecklist } from '../../components/icons';

import { renderBulletedListPreview, renderNumberedListPreview, renderTodoListPreview } from './preview';
import type { StyleConfig } from './types';

/**
 * Available style configurations for list items
 */
export const STYLE_CONFIGS: StyleConfig[] = [
  {
    name: 'bulletedList',
    titleKey: 'bulletedList',
    style: 'unordered',
    icon: IconListBulleted,
  },
  {
    name: 'numberedList',
    titleKey: 'numberedList',
    style: 'ordered',
    icon: IconListNumbered,
  },
  {
    name: 'todoList',
    titleKey: 'todoList',
    style: 'checklist',
    icon: IconListChecklist,
  },
] as const;

/**
 * Toolbox configuration for the list tool
 */
export const getToolboxConfig = (): ToolboxConfig => [
  {
    icon: IconListBulleted,
    titleKey: 'bulletedList',
    data: { style: 'unordered' },
    name: 'bulleted-list',
    searchTerms: ['ul', 'bullet', 'unordered', 'list'],
    searchTermKeys: ['bullet', 'unordered', 'list'],
    shortcut: 'CMD+SHIFT+5',
    section: 'basic',
    preview: { render: renderBulletedListPreview, descriptionKey: 'toolbox.preview.bulletedList' },
  },
  {
    icon: IconListNumbered,
    titleKey: 'numberedList',
    data: { style: 'ordered' },
    name: 'numbered-list',
    searchTerms: ['ol', 'ordered', 'number', 'list'],
    searchTermKeys: ['ordered', 'number', 'list'],
    shortcut: 'CMD+SHIFT+6',
    section: 'basic',
    preview: { render: renderNumberedListPreview, descriptionKey: 'toolbox.preview.numberedList' },
  },
  {
    icon: IconListChecklist,
    titleKey: 'todoList',
    data: { style: 'checklist' },
    name: 'check-list',
    searchTerms: ['checkbox', 'task', 'todo', 'check', 'list'],
    searchTermKeys: ['checkbox', 'task', 'todo', 'check', 'list'],
    shortcut: 'CMD+SHIFT+7',
    section: 'basic',
    preview: { render: renderTodoListPreview, descriptionKey: 'toolbox.preview.todoList' },
  },
];
