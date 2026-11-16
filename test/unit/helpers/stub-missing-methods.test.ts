import { describe, expect, it } from 'vitest';

import { stubMissingMethods } from './stub-missing-methods';

class Base {
  public fromBase(): string {
    return 'real';
  }
}

class Real extends Base {
  public own(): string {
    return 'real';
  }

  public kept(): string {
    return 'real';
  }

  public get value(): string {
    return 'real';
  }
}

describe('stubMissingMethods', () => {
  it('adds a no-op for each real method the fake lacks, base methods included, and keeps the fake\'s own', () => {
    class Fake {
      public kept(): string {
        return 'fake';
      }
    }

    stubMissingMethods(Fake, Real);

    const fake = new Fake() as Fake & Partial<Record<'own' | 'fromBase' | 'value', unknown>>;

    expect(fake.kept()).toBe('fake');
    expect(typeof fake.own).toBe('function');
    expect(typeof fake.fromBase).toBe('function');
    expect(fake.value).toBeUndefined();
  });
});
