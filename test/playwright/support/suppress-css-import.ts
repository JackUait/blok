import Module from 'module';

// @ts-expect-error Module._load is internal
const originalLoad = Module._load;

// @ts-expect-error Module._load is internal
Module._load = function (request: string, parent: any, isMain: boolean) {
  if (request.includes('?inline') || request.endsWith('.css')) {
    return '';
  }

  return originalLoad(request, parent, isMain);
};
