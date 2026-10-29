import { describe, expect, it } from 'vitest';

import { overrideStatic } from '../../../../src/components/utils/override-static';

const baseDescribe = (): string => 'base';

class Base {
  public static get describe(): () => string {
    return baseDescribe;
  }

  public static set describe(value: () => string) {
    overrideStatic(this, 'describe', value);
  }
}

describe('overrideStatic', () => {
  it('turns an assignment into an own, writable, enumerable data property', () => {
    class Sub extends Base {}
    const own = (): string => 'own';

    Sub.describe = own;

    expect(Object.getOwnPropertyDescriptor(Sub, 'describe')).toEqual({
      value: own,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect(Base.describe).toBe(baseDescribe);
  });

  it('lets a later assignment replace the first one', () => {
    class Sub extends Base {}
    const second = (): string => 'second';

    Sub.describe = (): string => 'first';
    Sub.describe = second;

    expect(Sub.describe).toBe(second);
  });
});
