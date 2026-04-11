/**
 * Display information for a user, returned by the resolveUser callback.
 * The host application can attach any additional fields beyond `name`.
 */
export interface UserInfo {
  /**
   * Display name for the user.
   * This is the only field Blok reads — shown in the "Last edited by" footer.
   */
  name: string;

  /** Host app can attach any additional fields */
  [key: string]: unknown;
}
