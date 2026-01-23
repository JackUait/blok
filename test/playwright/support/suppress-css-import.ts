import { Module } from 'module';

type ModuleLoadFunction = (
  request: string,
  parent: unknown,
  isMain: boolean
) => unknown;

// @ts-expect-error Module._load is internal
const originalLoad = Module._load as ModuleLoadFunction;

// @ts-expect-error Module._load is internal
Module._load = function (request: string, parent: unknown, isMain: boolean): unknown {
  if (request.includes('?inline') || request.endsWith('.css')) {
    return '';
  }

  return originalLoad(request, parent, isMain);
} as ModuleLoadFunction;
