/**
 * Test file for TypeScript type definitions
 * This file verifies that all types are properly exported and accessible
 */

import type { BlokConfig, OutputBlockData } from '@jackuait/blok';
import type { OutputData } from '@jackuait/blok';
import Blok from '@jackuait/blok';
import { loadLocale } from '@jackuait/blok/locales';

// Test BlokConfig type
const config: BlokConfig = {
  holder: 'editor',
  tools: {},
  data: {
    blocks: []
  }
};

// Test Blok constructor type
const editor: Blok = new Blok(config);

// Test OutputData type
const data: OutputData = {
  blocks: [
    {
      id: '1',
      type: 'paragraph',
      data: {
        text: 'Test'
      }
    }
  ]
};

// Test OutputBlockData type
const _block: OutputBlockData = {
  id: '1',
  type: 'paragraph',
  data: {
    text: 'Test'
  }
};

// Test loadLocale type
void loadLocale('en');

// Test API methods
const _testAPI = async (): Promise<void> => {
  const _savedData = await editor.save();
  await editor.clear();
  await editor.render(data);
  await editor.destroy();
};

console.log('TypeScript types verified successfully');
