import { describe, it, expect } from 'vitest';
import type { OutputBlockData } from '../../../types/data-formats/output-data';
import type { BlokConfig } from '../../../types/configs/blok-config';
import type { UserInfo } from '../../../types/configs/user-info';

describe('Block edit metadata types', () => {
  it('OutputBlockData accepts lastEditedAt and lastEditedBy as user ID', () => {
    const block: OutputBlockData = {
      type: 'paragraph',
      data: { text: 'Hello' },
      lastEditedAt: 1712880000000,
      lastEditedBy: 'user-123',
    };

    expect(block.lastEditedAt).toBe(1712880000000);
    expect(block.lastEditedBy).toBe('user-123');
  });

  it('OutputBlockData works without metadata (backward compat)', () => {
    const block: OutputBlockData = {
      type: 'paragraph',
      data: { text: 'Hello' },
    };

    expect(block.lastEditedAt).toBeUndefined();
    expect(block.lastEditedBy).toBeUndefined();
  });

  it('BlokConfig accepts user with id', () => {
    const config: BlokConfig = {
      user: { id: 'user-123' },
    };

    expect(config.user?.id).toBe('user-123');
  });

  it('BlokConfig accepts resolveUser callback', () => {
    const resolver = (id: string): UserInfo | null => {
      if (id === 'user-123') {
        return { name: 'Jack Uait' };
      }

      return null;
    };

    const config: BlokConfig = {
      resolveUser: resolver,
    };

    expect(config.resolveUser?.('user-123')).toEqual({ name: 'Jack Uait' });
    expect(config.resolveUser?.('unknown')).toBeNull();
  });

  it('BlokConfig accepts async resolveUser callback', async () => {
    const resolver = async (id: string): Promise<UserInfo | null> => {
      if (id === 'user-123') {
        return { name: 'Jack Uait' };
      }

      return null;
    };

    const config: BlokConfig = {
      resolveUser: resolver,
    };

    await expect(config.resolveUser?.('user-123')).resolves.toEqual({ name: 'Jack Uait' });
  });

  it('UserInfo allows extra fields beyond name', () => {
    const user: UserInfo = {
      name: 'Jack Uait',
      avatar: 'https://example.com/avatar.png',
      role: 'admin',
    };

    expect(user.name).toBe('Jack Uait');
    expect(user.avatar).toBe('https://example.com/avatar.png');
  });

  it('BlokConfig works without user option (backward compat)', () => {
    const config: BlokConfig = {};

    expect(config.user).toBeUndefined();
    expect(config.resolveUser).toBeUndefined();
  });
});
