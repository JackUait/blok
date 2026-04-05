import { describe, it, expect } from 'vitest';
import { Table } from '../../../../src/tools/table';
import { clean, sanitizeBlocks } from '../../../../src/components/utils/sanitizer';
import type { SanitizerConfig } from '../../../../types';
import type { TableData } from '../../../../src/tools/table/types';

describe('Table static configs', () => {
  it('sanitize allows br, b, i, a tags in content', () => {
    const config = Table.sanitize;

    expect(config.content).toBeDefined();
    expect(config.content).toHaveProperty('br', true);
    expect(config.content).toHaveProperty('b', true);
    expect(config.content).toHaveProperty('a');
    expect(config.content).toHaveProperty('input', { type: true, checked: true });
  });

  it('sanitize allows strong tag in content', () => {
    const config = Table.sanitize;

    expect(config.content).toHaveProperty('strong', true);
  });

  it('sanitize allows em tag in content', () => {
    const config = Table.sanitize;

    expect(config.content).toHaveProperty('em', true);
  });

  it('sanitize has a mark rule in content', () => {
    const config = Table.sanitize;

    expect(config.content).toHaveProperty('mark');
    expect((config.content as Record<string, unknown>)['mark']).toBeTruthy();
  });

  it('sanitize strips disallowed CSS properties from mark elements, keeping only color and background-color', () => {
    const markRule = (Table.sanitize.content as SanitizerConfig)['mark'];
    const result = clean(
      '<mark style="font-size:20px;background-color:yellow">hi</mark>',
      { mark: markRule }
    );

    expect(result).not.toContain('font-size');
    expect(result).toContain('background-color');
  });

  it('sanitize strips all styles from mark element when none are allowed', () => {
    const markRule = (Table.sanitize.content as SanitizerConfig)['mark'];
    const result = clean(
      '<mark style="font-size:20px;text-decoration:underline">hi</mark>',
      { mark: markRule }
    );

    expect(result).not.toContain('font-size');
    expect(result).not.toContain('text-decoration');
  });

  describe('Table.sanitize — deepSanitize behaviour', () => {
    it('preserves <strong>, <em>, and <mark style> in legacy cell content after sanitizeBlocks', () => {
      const tableData: TableData = {
        withHeadings: false,
        withHeadingColumn: false,
        content: [
          ['<strong>bold</strong>', '<em>italic</em>'],
          ['<mark style="background-color:yellow">hi</mark>', 'plain'],
        ],
      };

      const blocks = [{ tool: 'table', data: tableData }];
      const result = sanitizeBlocks(blocks, Table.sanitize);

      const outputData = result[0].data as TableData;
      const content = outputData.content as string[][];

      expect(content[0][0]).toContain('<strong>bold</strong>');
      expect(content[0][1]).toContain('<em>italic</em>');
      expect(content[1][0]).toContain('<mark');
      expect(content[1][0]).toContain('background-color:yellow');
      expect(content[1][0]).toContain('hi</mark>');
    });
  });

  it('sanitize allows a tag with href, target _blank, and rel nofollow in content', () => {
    const config = Table.sanitize;
    const aRule = (config.content as Record<string, unknown>)['a'];

    expect(aRule).toEqual({ href: true, target: '_blank', rel: 'nofollow' });
  });

  it('paste config handles TABLE, TR, TH, TD tags', () => {
    const config = Table.pasteConfig;

    expect(config).not.toBe(false);

    if (config !== false) {
      expect(config.tags).toEqual(expect.arrayContaining(['TABLE', 'TR', 'TH', 'TD']));
    }
  });
});
