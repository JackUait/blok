const send = (message) => chrome.runtime.sendMessage(message);

const isLocalhost = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);

const confirmIfRemote = (origin) =>
  isLocalhost(origin) || window.confirm(`Arm NON-LOCAL origin ${origin}?\n\nEvery page on it will run your local blok build.`);

const render = async () => {
  const { armedOrigins, current } = await send({ type: 'status' });

  const status = document.getElementById('payload-status');
  status.textContent = current
    ? `local payload: ${current.version} (built ${current.builtAt})`
    : 'No payload synced yet — run `yarn override:sync` in the blok repo.';

  const list = document.getElementById('armed-list');
  list.textContent = '';
  for (const origin of armedOrigins) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = origin;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Disarm';
    remove.addEventListener('click', async () => {
      await send({ type: 'disarm', origin });
      await render();
    });
    item.append(label, remove);
    list.appendChild(item);
  }

  const tabRow = document.getElementById('active-tab-row');
  tabRow.textContent = '';
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.url && /^https?:/.test(tab.url)) {
    const origin = new URL(tab.url).origin;
    const armed = armedOrigins.includes(origin);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = armed ? `Disarm ${origin}` : `Arm ${origin}`;
    button.addEventListener('click', async () => {
      if (armed) {
        await send({ type: 'disarm', origin });
      } else if (confirmIfRemote(origin)) {
        await send({ type: 'arm', origin });
      }
      await render();
    });
    tabRow.appendChild(button);
  }
};

document.getElementById('arm-button').addEventListener('click', async () => {
  const input = document.getElementById('origin-input');
  let origin;
  try {
    origin = new URL(input.value).origin;
  } catch {
    input.setCustomValidity('Enter a full origin, e.g. https://kb.example.com');
    input.reportValidity();
    return;
  }
  if (confirmIfRemote(origin)) {
    await send({ type: 'arm', origin });
    input.value = '';
    await render();
  }
});

void render();
