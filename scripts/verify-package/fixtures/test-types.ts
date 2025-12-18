/**
 * Test file for TypeScript type definitions
 * This file verifies that all types are properly exported and accessible
 */

import type { BlokConfig, BlokData, OutputBlockData } from '@jackuait/blok';
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

// Test BlokData type
const data: BlokData = {
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
const block: OutputBlockData = {
  id: '1',
  type: 'paragraph',
  data: {
    text: 'Test'
  }
};

// Test loadLocale type
const locale = loadLocale('en');

// Test API methods
async function testAPI() {
  const savedData = await editor.save();
  await editor.clear();
  await editor.render(data);
  await editor.destroy();
}

console.log('TypeScript types verified successfully');
