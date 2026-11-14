import { describe, expect, it } from 'vitest';
import {
  MEMBERS_ROLES_INTRO,
  PAGE_LEVELS,
  PAGE_LEVEL_DESCRIPTIONS,
  PAGE_RIGHTS_CUMULATIVE,
  SIGNUP_POLICIES,
  WORKSPACE_CREATION_POLICIES,
  WORKSPACE_ROLE_DESCRIPTIONS,
  WORKSPACE_ROLES,
  pageLevelOptions,
  roleOptions,
  signupPolicyOptions,
  workspaceCreationOptions,
} from './access-vocabulary';

describe('access vocabulary', () => {
  it('keeps workspace role labels identical to what the UI shows today', () => {
    expect(WORKSPACE_ROLES).toEqual({
      admin: 'Administrateur',
      member: 'Membre',
      viewer: 'Lecture seule',
    });
  });

  it('keeps page level labels identical to the share sheet', () => {
    expect(PAGE_LEVELS).toEqual({
      view: 'Peut voir',
      edit: 'Peut modifier',
      full: 'Accès complet',
    });
  });

  it('builds role options with labels and descriptions', () => {
    expect(roleOptions(true)).toEqual([
      { value: 'member', label: WORKSPACE_ROLES.member, description: WORKSPACE_ROLE_DESCRIPTIONS.member },
      { value: 'viewer', label: WORKSPACE_ROLES.viewer, description: WORKSPACE_ROLE_DESCRIPTIONS.viewer },
      { value: 'admin', label: WORKSPACE_ROLES.admin, description: WORKSPACE_ROLE_DESCRIPTIONS.admin },
    ]);
    expect(roleOptions(false)).toEqual([
      { value: 'member', label: WORKSPACE_ROLES.member, description: WORKSPACE_ROLE_DESCRIPTIONS.member },
      { value: 'viewer', label: WORKSPACE_ROLES.viewer, description: WORKSPACE_ROLE_DESCRIPTIONS.viewer },
    ]);
  });

  it('builds page level options with labels and descriptions', () => {
    expect(pageLevelOptions()).toEqual([
      { value: 'view', label: PAGE_LEVELS.view, description: PAGE_LEVEL_DESCRIPTIONS.view },
      { value: 'edit', label: PAGE_LEVELS.edit, description: PAGE_LEVEL_DESCRIPTIONS.edit },
      { value: 'full', label: PAGE_LEVELS.full, description: PAGE_LEVEL_DESCRIPTIONS.full },
    ]);
  });

  it('names the cumulative ceiling and the members-panel intro', () => {
    expect(PAGE_RIGHTS_CUMULATIVE).toContain('s’ajoutent');
    expect(PAGE_RIGHTS_CUMULATIVE).toContain('lecteur de l’espace');
    expect(MEMBERS_ROLES_INTRO).toContain(WORKSPACE_ROLES.admin);
    expect(MEMBERS_ROLES_INTRO).toContain(WORKSPACE_ROLES.member);
    expect(MEMBERS_ROLES_INTRO).toContain(WORKSPACE_ROLES.viewer);
  });

  it('exposes signup and workspace-creation policies with consequence sentences', () => {
    expect(SIGNUP_POLICIES.invite.consequence).toContain('Invitation seule');
    expect(WORKSPACE_CREATION_POLICIES.admins_only.label).toContain('Administrateurs');
    expect(signupPolicyOptions().map((item) => item.value)).toEqual(['invite', 'domain', 'open']);
    expect(workspaceCreationOptions().map((item) => item.value)).toEqual(['anyone', 'admins_only', 'disabled']);
  });
});
