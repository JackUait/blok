/**
 * Notifier.stories.ts - Stories for notification component states.
 *
 * This file covers notification types and styles:
 * - Alert (default, success, error)
 * - Confirm (with ok/cancel buttons)
 * - Prompt (with input field)
 */
import type { Meta, StoryObj } from '@storybook/html-vite';
import { waitFor, expect } from 'storybook/test';

interface NotifierArgs {
  message: string;
  style?: 'success' | 'error';
  type?: 'alert' | 'confirm' | 'prompt';
}

const TIMEOUT_ACTION = { timeout: 5000 };

// Helper functions to find notification elements using data-blok-testid selectors
const getNotifyWrapper = (): Element | null => document.querySelector('[data-blok-testid="notifier-container"]');
const getNotify = (): Element | null => document.querySelector('[data-blok-testid="notification"]');
const getNotifyByStyle = (style: string): Element | null => document.querySelector(`[data-blok-testid="notification-${style}"]`);
const getNotifyButton = (type: 'confirm' | 'cancel'): Element | null => document.querySelector(`[data-blok-testid="notification-${type}-button"]`);
const getNotifyInput = (): Element | null => document.querySelector('[data-blok-testid="notification-input"]');

/**
 * Clean up any existing notifications before each test
 */
const cleanupNotifications = (): void => {
  const wrapper = document.querySelector('[data-blok-testid="notifier-container"]');

  if (wrapper) {
    wrapper.innerHTML = '';
  }
};

/**
 * Dynamically imports and shows notification
 */
const showNotification = async (options: {
  message: string;
  type?: string;
  style?: string;
  time?: number;
  okText?: string;
  cancelText?: string;
  okHandler?: (event: Event | string) => void;
  cancelHandler?: (event: Event) => void;
  placeholder?: string;
  default?: string;
}): Promise<void> => {
  const notifierModule = await import('../components/utils/notifier/index');

  notifierModule.show(options);
};

const createNotifierDemo = (): HTMLElement => {
  const container = document.createElement('div');

  container.style.minHeight = '200px';
  container.style.backgroundColor = '#f5f5f5';
  container.style.padding = '20px';
  container.style.position = 'relative';

  const info = document.createElement('p');

  info.textContent = 'Notifications appear in the bottom-left corner of the viewport.';
  info.style.color = '#666';
  info.style.fontSize = '14px';
  container.appendChild(info);

  return container;
};

const meta: Meta<NotifierArgs> = {
  title: 'Components/Notifier',
  tags: ['autodocs'],
  args: {
    message: 'This is a notification message',
    style: undefined,
    type: 'alert',
  },
  argTypes: {
    message: {
      control: 'text',
      description: 'Notification message (can contain HTML)',
    },
    style: {
      control: 'select',
      options: [undefined, 'success', 'error'],
      description: 'Notification style variant',
    },
    type: {
      control: 'select',
      options: ['alert', 'confirm', 'prompt'],
      description: 'Notification type',
    },
  },
  render: createNotifierDemo,
};

export default meta;

type Story = StoryObj<NotifierArgs>;

/**
 * Default alert notification.
 */
export const AlertDefault: Story = {
  args: {
    message: 'This is a default notification',
    type: 'alert',
  },
  play: async ({ step }) => {
    await step('Show default alert notification', async () => {
      await showNotification({
        message: 'This is a default notification',
        time: 30000, // Keep visible for story
      });

      await waitFor(
        () => {
          const wrapper = getNotifyWrapper();

          expect(wrapper).toBeTruthy();

          const notify = getNotify();

          expect(notify).toBeTruthy();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Success style alert notification (green accent).
 */
export const AlertSuccess: Story = {
  args: {
    message: 'Operation completed successfully!',
    type: 'alert',
    style: 'success',
  },
  play: async ({ step }) => {
    await step('Show success alert notification', async () => {
      await showNotification({
        message: 'Operation completed successfully!',
        style: 'success',
        time: 30000,
      });

      await waitFor(
        () => {
          const notify = getNotifyByStyle('success');

          expect(notify).toBeTruthy();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Error style alert notification (red accent).
 */
export const AlertError: Story = {
  args: {
    message: 'Something went wrong!',
    type: 'alert',
    style: 'error',
  },
  play: async ({ step }) => {
    await step('Show error alert notification', async () => {
      await showNotification({
        message: 'Something went wrong!',
        style: 'error',
        time: 30000,
      });

      await waitFor(
        () => {
          const notify = getNotifyByStyle('error');

          expect(notify).toBeTruthy();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Confirm notification with OK and Cancel buttons.
 */
export const ConfirmNotification: Story = {
  args: {
    message: 'Are you sure you want to proceed?',
    type: 'confirm',
  },
  play: async ({ step }) => {
    await step('Show confirm notification', async () => {
      await showNotification({
        message: 'Are you sure you want to proceed?',
        type: 'confirm',
        okText: 'Yes, proceed',
        cancelText: 'Cancel',
        okHandler: () => {
          // Handler for story demo
        },
        cancelHandler: () => {
          // Handler for story demo
        },
      });

      await waitFor(
        () => {
          const notify = getNotify();

          expect(notify).toBeTruthy();

          // Check for confirm/cancel buttons
          const confirmBtn = getNotifyButton('confirm');
          const cancelBtn = getNotifyButton('cancel');

          expect(confirmBtn).toBeTruthy();
          expect(cancelBtn).toBeTruthy();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Prompt notification with input field.
 */
export const PromptNotification: Story = {
  args: {
    message: 'Enter your name:',
    type: 'prompt',
  },
  play: async ({ step }) => {
    await step('Show prompt notification', async () => {
      await showNotification({
        message: 'Enter your name:',
        type: 'prompt',
        placeholder: 'Your name',
        default: '',
        okHandler: () => {
          // Handler for story demo
        },
      });

      await waitFor(
        () => {
          const notify = getNotify();

          expect(notify).toBeTruthy();

          // Check for input field
          const input = getNotifyInput();

          expect(input).toBeTruthy();
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Notification with HTML content.
 */
export const WithHTMLContent: Story = {
  args: {
    message: 'Block <strong>deleted</strong> successfully',
    type: 'alert',
    style: 'success',
  },
  play: async ({ step }) => {
    await step('Clean up and show notification with HTML', async () => {
      cleanupNotifications();

      await showNotification({
        message: 'Block <strong>deleted</strong> successfully',
        style: 'success',
        time: 30000,
      });

      await waitFor(
        () => {
          const notify = getNotifyByStyle('success');

          expect(notify).toBeTruthy();

          // Check that notification contains the word 'deleted' (HTML may be sanitized)
          expect(notify?.textContent).toContain('deleted');
        },
        TIMEOUT_ACTION
      );
    });
  },
};

/**
 * Bounce-in animation on notification appear.
 */
export const BounceInAnimation: Story = {
  args: {
    message: 'Watch the bounce animation!',
    type: 'alert',
  },
  parameters: {
    chromatic: { disableSnapshot: true },
  },
  play: async ({ step }) => {
    await step('Show notification with bounce animation', async () => {
      await showNotification({
        message: 'Watch the bounce animation!',
        time: 30000,
      });

      await waitFor(
        () => {
          const notify = getNotify();

          expect(notify).toBeTruthy();
          // Check animation state via data attribute
          expect(notify?.getAttribute('data-blok-bounce-in')).toBe('true');
        },
        TIMEOUT_ACTION
      );
    });
  },
};
