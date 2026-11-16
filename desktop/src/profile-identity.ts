/** A display fallback never becomes the saved, editable name. */
export const profileDisplayName = (name: string | undefined, email?: string): string =>
  name?.trim() || email?.trim() || 'Utilisateur local';

export const profileInitial = (name: string): string =>
  Array.from(name.trim())[0]?.toLocaleUpperCase() || 'U';
