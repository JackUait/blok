/**
 * Real cloud browser integration (never sends real mail).
 * Start the service with APP_ENV=development, DEV_MAIL_DIRECTORY=<absolute path>,
 * BOOTSTRAP_ADMIN_EMAIL=admin@example.test and an isolated test database.
 * Start/proxy the desktop app against that service, then run from repository root:
 * CLOUD_E2E_URL=http://localhost:1420 CLOUD_E2E_MAIL_DIR=/tmp/blok-test-mail \
 *   node desktop/src/cloud/browser-e2e.mjs
 * Requires @playwright/test and its Chromium browser. No API/session mocking.
 */
import {chromium, expect} from '@playwright/test';
import {readFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const baseURL = process.env.CLOUD_E2E_URL || 'http://localhost:1420';
const mailbox = process.env.CLOUD_E2E_MAIL_DIR;
if (!mailbox) throw new Error('CLOUD_E2E_MAIL_DIR must identify the development-only mail directory.');
const adminEmail = process.env.CLOUD_E2E_ADMIN_EMAIL || 'admin@example.test';
const applicantEmail = `member-${Date.now()}@example.test`;
if (![adminEmail,applicantEmail].every(email => email.endsWith('@example.test'))) throw new Error('Use only example.test addresses and an isolated development backend.');
const launchOptions = {headless:process.env.CLOUD_E2E_HEADED !== '1'};
const browser = await chromium.launch(launchOptions).catch(error => {
  if (!String(error).includes("Executable doesn't exist")) throw error;
  return chromium.launch({...launchOptions,channel:'chrome'});
});
const adminContext = await browser.newContext({baseURL});
const memberContext = await browser.newContext({baseURL});
const admin = await adminContext.newPage();
await memberContext.addInitScript(() => {
  // Keep real WebSockets, exposing only a test handle to interrupt the transport.
  // Chromium offline emulation alone leaves already-open WebSockets alive.
  const NativeWebSocket = window.WebSocket;
  window.__cloudE2ESockets = new Set();
  window.WebSocket = class extends NativeWebSocket {
    constructor(...args) {super(...args);window.__cloudE2ESockets.add(this);this.addEventListener('close',() => window.__cloudE2ESockets.delete(this));}
  };
});
const member = await memberContext.newPage();
const errors = [];
for (const page of [admin,member]) page.on('pageerror', error => errors.push(error.message));
async function mailboxCode(email, requestedAt) {
  const filename = resolve(mailbox, `${createHash('sha256').update(email.toLowerCase()).digest('hex')}.json`);
  let code;
  await expect.poll(async () => {
    try {
      const mail = JSON.parse(await readFile(filename,'utf8'));
      if (mail.to !== email) return false;
      // File overwrite per address means the request timestamp and OTP heading
      // distinguish this login from invitation mail or a previous run.
      if ((await stat(filename)).mtimeMs < requestedAt - 1000) return false;
      code = mail.text.match(/code de connexion\s*:\s*(\d{6})/i)?.[1];
      return Boolean(code);
    } catch {return false;}
  },{timeout:15000,message:`development login mail for ${email}`}).toBe(true);
  return code;
}
async function login(page,email) {
  await page.goto('/');
  await page.getByLabel('Adresse e-mail',{exact:true}).fill(email);
  const requestedAt = Date.now();
  await page.getByRole('button',{name:'Continuer par e-mail',exact:true}).click();
  await expect(page.getByLabel('Code de connexion')).toBeVisible();
  await page.getByLabel('Code de connexion').fill(await mailboxCode(email,requestedAt));
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Où souhaitez-vous travailler ?'})).toBeVisible();
}
async function json(page,path,init) {
  const response = await page.request.fetch(path,init);
  return {status:response.status(),body:await response.json()};
}
try {
  await login(member,applicantEmail);
  console.log('Member email login passed.');
  await member.getByLabel('Un mot pour l’équipe (facultatif)').fill('Demande du test navigateur isolé.');
  await member.getByRole('button',{name:'Demander à rejoindre',exact:true}).click();
  await expect(member.getByText('Votre demande est en attente',{exact:true})).toBeVisible();
  await expect(member.locator('[data-desktop-shell]')).toHaveCount(0);
  expect((await json(member,'/api/workspaces/tousambassadeurs/index')).status).toBe(403);
  console.log('Pending applicant denied document access.');
  await login(admin,adminEmail);
  console.log('Admin email login passed.');
  await admin.getByRole('button',{name:'Gérer',exact:true}).first().click();
  await admin.screenshot({path:'/tmp/blok-cloud-admin.png',fullPage:true});
  await admin.setViewportSize({width:390,height:1000});
  await admin.screenshot({path:'/tmp/blok-cloud-admin-mobile.png',fullPage:true});
  expect(await admin.evaluate(() => document.querySelector('[data-cloud-gateway]').scrollWidth <= window.innerWidth)).toBe(true);
  await admin.setViewportSize({width:1280,height:720});
  const applicantRow = admin.locator('[data-cloud-row]').filter({has:admin.getByText(applicantEmail,{exact:true})});
  await expect(applicantRow).toBeVisible();
  await applicantRow.getByRole('button',{name:'Accepter',exact:true}).click();
  await expect(admin.getByRole('button',{name:`Rôle de ${applicantEmail}`,exact:true})).toBeVisible();
  console.log('Admin approved applicant through browser UI.');
  await member.getByRole('button',{name:'Actualiser le statut',exact:true}).click();
  await member.getByRole('button',{name:'Ouvrir l’espace',exact:true}).first().click();
  await expect(member.locator('[data-desktop-shell]')).toBeVisible();
  // Wait for the previous editor to finish mounting, then for its DOM to leave.
  // A visible old title must never satisfy the new-page editor assertion.
  const initialIndex = await json(member,'/api/workspaces/tousambassadeurs/index');
  if (initialIndex.body.pages.length) await expect(member.locator('[data-blok-page-title]').first()).toBeVisible({timeout:20000});
  const previousTitle = initialIndex.body.pages.length ? await member.locator('[data-blok-page-title]').first().elementHandle() : null;
  const previousURL = member.url();
  await member.getByRole('button',{name:'Nouvelle page',exact:true}).first().click();
  await expect.poll(() => member.url()).not.toBe(previousURL);
  if (previousTitle) await previousTitle.waitForElementState('hidden');
  const title = member.locator('[data-blok-page-title]').first();
  await expect(title).toBeVisible({timeout:20000});
  await expect(title).toHaveAttribute('contenteditable','true',{timeout:20000});
  const text = `Validation navigateur ${Date.now()}`;
  await title.fill(text);
  const paragraph = member.locator('[data-blok-redactor] [contenteditable="true"]').first();
  await expect(paragraph).toBeVisible();
  await paragraph.fill(`Texte partagé : ${text}`);
  await expect(member.locator('[data-desktop-status]')).toHaveAttribute('data-sync-state','connected',{timeout:20000});
  const indexBefore = await json(member,'/api/workspaces/tousambassadeurs/index');
  expect(indexBefore.status).toBe(200);
  await expect.poll(async () => (await json(member,'/api/workspaces/tousambassadeurs/index')).body.pages.some(page => page.title === text),{timeout:15000}).toBe(true);
  await member.reload();
  // The app can restore the chosen workspace or return to the authenticated selector.
  await expect.poll(async () => (await member.locator('[data-desktop-shell]').isVisible()) || (await member.getByRole('button',{name:'Ouvrir l’espace',exact:true}).first().isVisible().catch(() => false))).toBe(true);
  if (await member.getByRole('button',{name:'Ouvrir l’espace',exact:true}).first().isVisible().catch(() => false)) await member.getByRole('button',{name:'Ouvrir l’espace',exact:true}).first().click();
  await expect(member.locator('[data-blok-page-title]').first()).toHaveText(text,{timeout:20000});
  await expect(member.locator('[data-blok-redactor]')).toContainText(`Texte partagé : ${text}`,{timeout:20000});
  console.log('Editor title and body persisted across reload.');
  // Paste a real PNG file into the editor: its normal uploader and renderer run.
  await member.locator('[data-blok-redactor] [contenteditable="true"]').first().focus();
  await member.evaluate(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1UAAAAASUVORK5CYII='),character => character.charCodeAt(0));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes],'cloud-e2e.png',{type:'image/png'}));
    document.activeElement.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));
  });
  const uploadedImage = member.locator('[data-blok-redactor] img[src*="/files/"]').first();
  await expect(uploadedImage).toBeVisible({timeout:20000});
  await expect.poll(() => uploadedImage.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  const assetURL = await uploadedImage.getAttribute('src');
  const anonymousContext = await browser.newContext({baseURL});
  expect([401,403]).toContain((await anonymousContext.request.get(assetURL)).status());
  await anonymousContext.close();
  console.log('Pasted private image uploaded and rendered; anonymous file access denied.');

  const peerContext = await browser.newContext({baseURL,storageState:await memberContext.storageState()});
  const peer = await peerContext.newPage(); peer.on('pageerror',error => errors.push(error.message));
  await peer.goto(member.url());
  await expect(peer.locator('[data-blok-page-title]').first()).toHaveText(text,{timeout:20000});
  await expect(peer.locator('[data-blok-redactor] img[src*="/files/"]').first()).toBeVisible({timeout:15000});
  const editable = '[data-blok-redactor] [contenteditable="true"]';
  await member.locator(editable).first().press('End');
  await member.keyboard.press('Enter'); await member.keyboard.type('Bloc A');
  await member.keyboard.press('Enter'); await member.keyboard.type('Bloc B');
  await expect(peer.locator('[data-blok-redactor]')).toContainText('Bloc B',{timeout:15000});
  const block = (page,label) => page.locator(editable).filter({hasText:label}).first();
  await Promise.all([block(member,'Bloc A').fill('Bloc A — contribution membre'),block(peer,'Bloc B').fill('Bloc B — contribution pair')]);
  for (const page of [member,peer]) {
    await expect(page.locator('[data-blok-redactor]')).toContainText('Bloc A — contribution membre',{timeout:15000});
    await expect(page.locator('[data-blok-redactor]')).toContainText('Bloc B — contribution pair',{timeout:15000});
    await expect(page.locator('[data-desktop-status]')).toHaveAttribute('data-sync-state','connected',{timeout:15000});
  }
  console.log('Two isolated browser contexts converged after concurrent edits.');
  await memberContext.setOffline(true);
  await expect.poll(() => member.evaluate(() => navigator.onLine)).toBe(false);
  await member.evaluate(() => {for (const socket of window.__cloudE2ESockets) if (socket.url.includes('/api/blok/')) socket.close(4000,'E2E transport interruption');});
  await expect(member.locator('[data-desktop-status]')).not.toHaveAttribute('data-sync-state','connected',{timeout:15000});
  await block(member,'Bloc A').fill('Bloc A — contribution membre hors ligne');
  await block(peer,'Bloc B').fill('Bloc B — contribution pair en ligne');
  await expect(peer.locator('[data-blok-redactor]')).not.toContainText('hors ligne');
  await memberContext.setOffline(false);
  for (const page of [member,peer]) {
    await expect(page.locator('[data-blok-redactor]')).toContainText('contribution membre hors ligne',{timeout:20000});
    await expect(page.locator('[data-blok-redactor]')).toContainText('contribution pair en ligne',{timeout:20000});
    await expect(page.locator('[data-desktop-status]')).toHaveAttribute('data-sync-state','connected',{timeout:20000});
  }
  await Promise.all([member.reload(),peer.reload()]);
  for (const page of [member,peer]) {
    await expect(page.locator('[data-blok-page-title]').first()).toHaveText(text,{timeout:20000});
    await expect(page.locator('[data-blok-redactor]')).toContainText('contribution membre hors ligne',{timeout:20000});
    await expect(page.locator('[data-blok-redactor]')).toContainText('contribution pair en ligne',{timeout:20000});
  }
  for (const page of [member,peer]) await expect.poll(() => page.locator('[data-blok-redactor] img[src*="/files/"]').first().evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await member.screenshot({path:'/tmp/blok-cloud-editor.png',fullPage:true});
  await peerContext.close();
  console.log('Offline and online edits converged after reconnect and persisted on both reloads.');

  const memberInfo = await json(member,'/api/session');
  const memberId = memberInfo.body.user.id;
  const role = admin.getByRole('button',{name:`Rôle de ${applicantEmail}`,exact:true});
  await role.click();
  await admin.getByRole('menuitemradio',{name:'Lecture seule',exact:true}).click();
  await expect(admin.getByRole('heading',{name:'Où souhaitez-vous travailler ?'})).toBeVisible();
  await expect.poll(async () => (await json(member,'/api/session')).body.workspaces.find(ws => ws.slug === 'tousambassadeurs')?.role).toBe('viewer');
  expect((await json(member,'/api/workspaces/tousambassadeurs/index',{method:'PUT',data:{...indexBefore.body}})).status).toBe(403);
  expect((await json(member,`/api/workspaces/tousambassadeurs/members/${memberId}`,{method:'PATCH',data:{role:'admin'}})).status).toBe(403);
  await admin.getByRole('button',{name:'Changer de compte',exact:true}).click();
  await expect(admin.getByLabel('Adresse e-mail',{exact:true})).toHaveValue('');
  expect((await json(admin,'/api/session')).status).toBe(401);
  expect(errors).toEqual([]);
  console.log('Cloud browser E2E passed: email login, pending ACL, approval, editor persistence, two clients, reconnect, roles, logout.');
} catch (error) {
  await member.screenshot({path:'/tmp/blok-cloud-e2e-member-failure.png',fullPage:true}).catch(() => {});
  await admin.screenshot({path:'/tmp/blok-cloud-e2e-admin-failure.png',fullPage:true}).catch(() => {});
  console.error('Browser page errors:',errors);
  throw error;
} finally {await browser.close();}
