import { el } from './dom';

export interface AvatarOptions {
  email: string;
  name?: string;
  attribute?: string;
}

/** Initial glyph from a display name, falling back to the email local-part. */
export function avatarInitials(options: { email: string; name?: string }): string {
  const name = options.name?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0];
    const second = parts[1];
    if (first !== undefined && second !== undefined) {
      return (first.charAt(0) + second.charAt(0)).toLocaleUpperCase();
    }
    return name.slice(0, 1).toLocaleUpperCase();
  }
  const local = options.email.split('@')[0] ?? options.email;
  return local.slice(0, 1).toLocaleUpperCase();
}

/** Circular avatar showing initials derived from name or email. */
export function createAvatar(options: AvatarOptions): HTMLSpanElement {
  const node = el('span', {
    text: avatarInitials(options),
    attribute: options.attribute ?? 'data-desktop-avatar',
  });
  node.setAttribute('aria-hidden', 'true');
  return node;
}
