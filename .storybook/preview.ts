import type { Preview } from "@storybook/html-vite";

// Import global editor styles
import "../src/styles/main.css";

const preview: Preview = {
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
      test: "todo",
    },
  },
  decorators: [
    (story) => {
      const container = document.createElement("div");

      container.style.fontFamily =
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif";
      container.style.padding = "20px";

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
