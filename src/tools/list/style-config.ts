/**
 * Style Config - Static configurations for list item styles.
 */

import type { ToolboxConfig } from '../../../types';
import { IconListBulleted, IconListNumbered, IconListChecklist } from '../../components/icons';

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
    title: 'Bulleted list',
    titleKey: 'bulletedList',
    data: { style: 'unordered' },
    name: 'bulleted-list',
    searchTerms: ['ul', 'bullet', 'unordered', 'list'],
    shortcut: '-',
  },
  {
    icon: IconListNumbered,
    title: 'Numbered list',
    titleKey: 'numberedList',
    data: { style: 'ordered' },
    name: 'numbered-list',
    searchTerms: ['ol', 'ordered', 'number', 'list'],
    shortcut: '1.',
  },
  {
    icon: IconListChecklist,
    title: 'To-do list',
    titleKey: 'todoList',
    data: { style: 'checklist' },
    name: 'check-list',
    searchTerms: ['checkbox', 'task', 'todo', 'check', 'list'],
    shortcut: '[]',
  },
];
