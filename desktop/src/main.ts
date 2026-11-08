import '../../src/styles/main.css';
import '../../src/shell/sidebar.css';
import './shell.css';
import { mountDesktop } from './shell';

if (import.meta.env.DEV) void import('react-grab');

const root = document.querySelector('#app');
if (root instanceof HTMLElement) mountDesktop(root);
