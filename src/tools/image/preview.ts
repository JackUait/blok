import { createPreview, h } from '../../components/utils/block-preview';
import SCENE from './preview-scene.svg?raw';

/** A photo of sunset over Lake Bled, with a caption line under it. */
export const renderImagePreview = (): HTMLElement => {
  const scene = h('div', { 'data-part': 'scene' });

  // The scene is static and never contains user data.
  scene.innerHTML = SCENE;

  return createPreview(
    'image',
    h('div', { 'data-part': 'photo' }, scene),
    h('div', { 'data-part': 'caption' }, 'Golden hour at Lake Bled')
  );
};
