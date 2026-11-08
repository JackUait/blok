import type { Preview } from "@storybook/html-vite";

// Import global editor styles
import "../src/styles/main.css";
// Blok loads the font faces lazily; stories rendered without an editor still need them.
import "../src/styles/fonts.css";

const preview: Preview = {
  initialGlobals: {
    reactGrab: true,
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#ffffff" },
        { name: "dark", value: "#1e1e1e" },
      ],
    },
    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: "error",
    },
  },
  decorators: [
    (story, context) => {
      const container = document.createElement("div");
      const fullscreen = context.parameters.layout === "fullscreen";

      container.style.fontFamily =
        "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif";
      if (fullscreen) {
        container.style.height = "100vh";
      } else {
        container.style.padding = "20px";
      }

      const storyContent = story();
      const isStringContent = typeof storyContent === "string";
      const isElementContent = storyContent instanceof HTMLElement;

      if (isStringContent) {
        container.innerHTML = storyContent;
      }

      if (isElementContent) {
        container.appendChild(storyContent);
      }

      return container;
    },
  ],
};

export default preview;
