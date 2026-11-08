import { mountDesktop } from './shell';

const root = document.querySelector('#app');
if (root instanceof HTMLElement) mountDesktop(root);
