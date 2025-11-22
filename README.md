<p align="center">
  <img width="75%" alt="Editor.js Logo" src="./assets/blok.png">
</p>

## About

**Blok** is a headless, highly extensible rich text editor built for developers who need to implement a block-based editing experience (similar to Notion) without building it from scratch.

Unlike traditional `contenteditable` solutions that treat text as a single HTML blob, Blok treats every piece of content—paragraphs, headings, images, lists—as an individual Block. This architecture allows for drag-and-drop reordering, complex nesting, and a strictly typed data structure.

**Key Features:**

**🧱 Block Architecture**: Content is structured as JSON data, not raw HTML, making it easy to parse, store, and render anywhere.

**⚡ Slash Commands**: Includes a built-in, customizable "Slash Menu" (/) for quick formatting and inserting media.

**🎨 Headless & Stylable**: Blok gives you the logic; you bring the UI. Fully compatible with Tailwind, Styled Components, or raw CSS.

**🖱️ Drag & Drop**: Native support for rearranging blocks with intuitive handles.

**🔌 Extensible Plugin System**: Easily create custom blocks (e.g., Kanbans, Embeds, Code Blocks) to fit your specific use case.
