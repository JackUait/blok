export interface IntegrationSection {
  id: string;
  badge?: string;
  title: string;
  description?: string;
  methods?: { name: string; returnType: string; description: string; example?: string }[];
  properties?: { name: string; type: string; description: string }[];
  table?: { option: string; type: string; default: string; description: string }[];
  example?: string;
  customType?: 'install';
}

// ─── React integration data ────────────────────────────────────────────────

const REACT_INSTALL_EXAMPLE = `# Install blok + peer dependency
yarn add @jackuait/blok react react-dom`;

const USE_BLOK_EXAMPLE = `import { useBlok, BlokContent } from '@jackuait/blok/react';
import { Header, Paragraph, List } from '@jackuait/blok/tools';

const tools = { header: Header, paragraph: Paragraph, list: List };

export function Editor() {
  const editor = useBlok({ tools });

  return <BlokContent editor={editor} className="my-editor" />;
}`;

const FULL_EXAMPLE = `import { useState } from 'react';
import { useBlok, BlokContent } from '@jackuait/blok/react';
import { Header, Paragraph, List } from '@jackuait/blok/tools';
import type { OutputData } from '@jackuait/blok';

const tools = { header: Header, paragraph: Paragraph, list: List };

const INITIAL_DATA: OutputData = {
  blocks: [
    { id: '1', type: 'header',    data: { text: 'Hello Blok', level: 1 } },
    { id: '2', type: 'paragraph', data: { text: 'Start writing…' } },
  ],
};

export function BlogEditor() {
  const [saved, setSaved] = useState<OutputData | null>(null);

  const editor = useBlok({
    tools,
    data: INITIAL_DATA,
    placeholder: 'Tell your story…',
    onChange: (api) => {
      console.log('content changed', api);
    },
    onReady: () => {
      console.log('editor ready');
    },
  });

  const handleSave = async () => {
    if (!editor) return;
    const data = await editor.save();
    setSaved(data);
  };

  return (
    <div>
      <BlokContent editor={editor} className="blog-editor" />
      <button onClick={handleSave} disabled={!editor}>
        Save
      </button>
      {saved && <pre>{JSON.stringify(saved, null, 2)}</pre>}
    </div>
  );
}`;

const CONTROLLED_EXAMPLE = `// data + onSave = a true controlled component
const [data, setData] = useState(INITIAL_DATA);

// data flows in (re-renders in place, deep-equal–deduped);
// onSave flows out (debounced, full serialized OutputData).
const editor = useBlok({ tools, data, onSave: setData });

// 'data' now mirrors editor content — persist it, diff it, etc.
// The deep-equal guard breaks the onSave -> setState -> data loop.
return <BlokContent editor={editor} />;`;

const READ_ONLY_EXAMPLE = `// Toggle read-only mode reactively — no editor recreation needed
const [readOnly, setReadOnly] = useState(false);

const editor = useBlok({ tools, readOnly });

// Changing readOnly calls editor.readOnly.set() automatically
<button onClick={() => setReadOnly(r => !r)}>
  {readOnly ? 'Edit' : 'Preview'}
</button>
<BlokContent editor={editor} />`;

const DEPS_EXAMPLE = `// Recreate the editor when documentId changes
const { documentId } = useParams();

const editor = useBlok(
  {
    tools,
    data: loadedData,           // initial data for this doc
    placeholder: 'Write here…',
  },
  [documentId],                 // deps — editor recreates when this changes
);

return <BlokContent editor={editor} />;`;

export const REACT_SECTIONS: IntegrationSection[] = [
  {
    id: 'react-install',
    badge: 'Setup',
    title: 'Installation',
    description:
      'Install Blok and its React adapter. React 18 or higher is required as a peer dependency.',
    customType: 'install',
    example: REACT_INSTALL_EXAMPLE,
  },
  {
    id: 'react-quickstart',
    badge: 'Guide',
    title: 'Quick Start',
    description:
      'Import useBlok and BlokContent from @jackuait/blok/react. The hook manages the editor lifecycle; the component mounts the editor DOM into your layout.',
    example: USE_BLOK_EXAMPLE,
  },
  {
    id: 'react-use-blok',
    badge: 'Hook',
    title: 'useBlok',
    description:
      'A React hook that creates and manages a Blok editor instance. Returns the editor once it is ready, or null during initialization.',
    table: [
      {
        option: 'config',
        type: 'UseBlokConfig',
        default: '—',
        description:
          'All standard Blok configuration options except holder, which is managed internally. Callbacks (onChange, onSave, onReady) are ref-stable and never cause recreation.',
      },
      {
        option: 'deps',
        type: 'unknown[]',
        default: '[]',
        description:
          'Optional dependency array. When any value changes, the editor is destroyed and recreated — useful when switching documents. Each value in the array should be referentially stable (a primitive, or a useMemo-stable object), since a dep whose identity changes every render recreates the editor. The values are compared individually, not the array wrapper, so a fresh array literal each render is fine when its values are stable.',
      },
    ],
    properties: [
      {
        name: 'return value',
        type: 'Blok | null',
        description:
          'The live editor instance once isReady resolves, or null during initialization and SSR.',
      },
    ],
  },
  {
    id: 'react-blok-content',
    badge: 'Component',
    title: 'BlokContent',
    description:
      'A component that mounts the editor\'s DOM tree into your layout. Renders an empty div when editor is null, maintaining layout stability while the editor initializes.',
    properties: [
      {
        name: 'editor',
        type: 'Blok | null',
        description: 'The instance returned by useBlok. Pass null during loading.',
      },
      {
        name: 'ref',
        type: 'Ref<HTMLDivElement>',
        description: 'Optional forwarded ref to the container div.',
      },
      {
        name: '...divProps',
        type: 'HTMLAttributes<HTMLDivElement>',
        description: 'All standard div attributes (className, style, id, aria-*, etc.) are passed through.',
      },
    ],
  },
  {
    id: 'react-controlled',
    badge: 'Guide',
    title: 'Controlled Component',
    description:
      'Pair the reactive data prop with onSave for a true controlled component. data flows in (re-rendered in place, deep-equal–deduped so the caret is never clobbered); onSave flows out, firing debounced with the full serialized OutputData on every change. Wiring onSave={setData} keeps your state in sync without polling editor.save() — the deep-equal guard on data breaks the round-trip loop. Use the lower-level onChange(api, event) when you need raw mutation events instead.',
    example: CONTROLLED_EXAMPLE,
  },
  {
    id: 'react-read-only',
    badge: 'Guide',
    title: 'Read-Only Mode',
    description:
      'Toggle read-only mode reactively by passing readOnly to useBlok. The editor updates via editor.readOnly.set() without recreation.',
    example: READ_ONLY_EXAMPLE,
  },
  {
    id: 'react-deps',
    badge: 'Guide',
    title: 'Switching Documents',
    description:
      'Pass a deps array as the second argument to useBlok to recreate the editor when your document changes. The old instance is destroyed cleanly before the new one is created. Keep deps values referentially stable — wrap objects and arrays (like uploaders) in useMemo so an unchanged dep keeps the same identity and avoids needless recreation.',
    example: DEPS_EXAMPLE,
  },
  {
    id: 'react-full-example',
    badge: 'Example',
    title: 'Complete Example',
    description: 'A full blog editor component using useBlok and BlokContent together.',
    example: FULL_EXAMPLE,
  },
];

