// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as namespace from '../../../../src/shared/agent';
import { COMMANDS } from '../../../../src/shared/agent/commands';
import { plannerContextFrom } from '../../../../src/shared/agent/context';
import { describeContract } from '../../../../src/shared/agent/describe';
import { createDocumentAgentSession, createPageMapBackend } from '../../../../src/shared/agent/document-session';
import { runBatch } from '../../../../src/shared/agent/executor';
import { applyEdits } from '../../../../src/shared/agent/json-applier';
import { contentRevision, canonicalJson } from '../../../../src/shared/agent/revision';
import { richTextHelpers } from '../../../../src/shared/agent/rich-text-ops';
import { DocSnapshot } from '../../../../src/shared/agent/snapshot';

describe('shared agent entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { name: 'COMMANDS', identity: COMMANDS },
    { name: 'createDocumentAgentSession', identity: createDocumentAgentSession },
    { name: 'createPageMapBackend', identity: createPageMapBackend },
    { name: 'plannerContextFrom', identity: plannerContextFrom },
    { name: 'runBatch', identity: runBatch },
    { name: 'DocSnapshot', identity: DocSnapshot },
    { name: 'applyEdits', identity: applyEdits },
    { name: 'contentRevision', identity: contentRevision },
    { name: 'canonicalJson', identity: canonicalJson },
    { name: 'richTextHelpers', identity: richTextHelpers },
    { name: 'describeContract', identity: describeContract },
  ])('exports $name from its implementation module', ({ name, identity }) => {
    expect(Reflect.get(namespace, name)).toBe(identity);
  });
});
