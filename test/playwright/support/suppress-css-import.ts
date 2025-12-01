import Module from 'module';

// @ts-expect-error Module._load is internal
const originalLoad = Module._load;

/**
 * Mock for uhtml's Hole class
 */
class MockHole {
  constructor(public s: boolean, public t: TemplateStringsArray, public v: unknown[]) {}
  toDOM(): Node {
    return document.createDocumentFragment();
  }
}

/**
 * Mock implementation of uhtml for Node.js context
 * Since uhtml uses document.createRange() at module load time,
 * we need to provide a mock when running in Node.js
 */
const uhtmlMock = {
  html: (template: TemplateStringsArray, ...values: unknown[]) => new MockHole(false, template, values),
  svg: (template: TemplateStringsArray, ...values: unknown[]) => new MockHole(true, template, values),
  render: (where: Element, _what: unknown) => where,
  Hole: MockHole,
  attr: {},
};

// @ts-expect-error Module._load is internal
 
Module._load = function (request: string, parent: any, isMain: boolean) {
  if (request.includes('?inline') || request.endsWith('.css')) {
    return '';
  }

  // Mock uhtml in Node.js context since it uses document.createRange() at module load time
  if (request === 'uhtml') {
    return uhtmlMock;
  }

  return originalLoad(request, parent, isMain);
};
