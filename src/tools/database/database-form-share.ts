import { IconLink, IconLock } from '../../components/icons';
import type { I18n } from '../../../types';
import { DatabasePanel, panelRow, panelSwitch } from './database-panel';
import { propertyTypeMeta } from './database-property-types';
import type { FormSettings, FormSubmissionAccess } from './types';

/** What the host can honour. Without one, Blok can only close the form itself. */
export interface FormShareHost {
  workspaceName?: string;
  link?: string;
}

export interface FormShareOptions {
  anchor: HTMLElement;
  i18n: Pick<I18n, 't'>;
  settings: () => FormSettings;
  host?: FormShareHost;
  /** Writes a patch; `undefined` drops the field. */
  update: (patch: Partial<FormSettings>) => void;
  copyLink: (link: string) => void;
  onClose: () => void;
}

type Who = 'workspace' | 'public' | 'closed';

const ACCESS: readonly FormSubmissionAccess[] = ['none', 'view', 'comment', 'edit', 'full'];

const ACCESS_KEYS: Record<FormSubmissionAccess, string> = {
  none: 'tools.database.formAccessNone',
  view: 'tools.database.formAccessView',
  comment: 'tools.database.formAccessComment',
  edit: 'tools.database.formAccessEdit',
  full: 'tools.database.formAccessFull',
};

export const whoCanFill = (settings: FormSettings | undefined): Who => {
  if (settings?.closed === true) return 'closed';

  return settings?.public === true ? 'public' : 'workspace';
};

/** The builder's grey line (research/19 §3d). Public and Closed wording is Blok's: Notion's is unmeasured. */
export const accessLine = (i18n: Pick<I18n, 't'>, settings: FormSettings | undefined, workspace: string | undefined): string => {
  const who = whoCanFill(settings);

  if (who === 'closed') return i18n.t('tools.database.formAccessBarClosed');
  if (who === 'public') return i18n.t('tools.database.formAccessBarPublic');

  return workspace === undefined || workspace.trim() === ''
    ? i18n.t('tools.database.formAccessBarWorkspaceGeneric')
    : i18n.t('tools.database.formAccessBarWorkspace', { workspace });
};

const badge = (row: HTMLElement, text: string, tone: Who): HTMLElement => {
  const mark = document.createElement('span');

  mark.setAttribute('data-blok-database-form-share-badge', tone);
  mark.textContent = text;
  row.querySelector('[data-blok-database-panel-label]')?.appendChild(mark);

  return row;
};

/**
 * Notion's "Share form" panel: who can fill out, anonymous responses, access
 * to submission and the form link. Blok runs no sharing service, so each
 * choice is stored on the view and handed to `config.forms`; without a host
 * only "No access" (Blok closes the form itself) is offered.
 */
export const openFormShare = (options: FormShareOptions): DatabasePanel => {
  const { i18n, host } = options;
  const workspace = host?.workspaceName?.trim() === '' ? undefined : host?.workspaceName;
  const whoLabel = (who: Who): string => {
    if (who === 'public') return i18n.t('tools.database.formWhoPublic');
    if (who === 'closed') return i18n.t('tools.database.formWhoNone');

    return workspace === undefined
      ? i18n.t('tools.database.formWhoWorkspaceGeneric')
      : i18n.t('tools.database.formWhoWorkspace', { workspace });
  };
  const choices: Who[] = host === undefined ? ['workspace', 'closed'] : ['workspace', 'public', 'closed'];
  const panel: DatabasePanel = new DatabasePanel({
    anchor: options.anchor,
    testId: 'database-form-share',
    width: 480,
    backLabel: i18n.t('tools.database.peekBack'),
    onClose: options.onClose,
    root: {
      build: () => {
        const settings = options.settings();
        const rows: HTMLElement[] = [panelRow({
          label: i18n.t('tools.database.formWhoCanFill'),
          value: whoLabel(whoCanFill(settings)),
          icon: propertyTypeMeta('person').icon,
          testId: 'database-form-share-who',
          opensPage: true,
          onClick: () => panel.push({
            title: i18n.t('tools.database.formWhoCanFill'),
            returnFocus: 'database-form-share-who',
            build: () => choices.map((who) => {
              const row = panelRow({
                label: whoLabel(who),
                testId: `database-form-share-who-${who}`,
                checked: whoCanFill(options.settings()) === who,
                onClick: () => {
                  options.update({ public: who === 'public' ? true : undefined, closed: who === 'closed' ? true : undefined });
                  panel.back();
                },
              });

              if (who === 'public') return badge(row, i18n.t('tools.database.formBadgePublic'), who);
              if (who === 'closed') return badge(row, i18n.t('tools.database.formBadgeClosed'), who);

              return row;
            }),
          }),
        })];

        if (host === undefined) return rows;
        const anonymous = panelSwitch({
          label: i18n.t('tools.database.formAnonymous'),
          testId: 'database-form-share-anonymous',
          checked: settings.anonymous === true,
          onToggle: (next) => options.update({ anonymous: next ? true : undefined }),
        });
        const access = settings.submissionAccess ?? 'none';

        rows.push(
          anonymous,
          panelRow({
            label: i18n.t('tools.database.formSubmissionAccess'),
            value: i18n.t(ACCESS_KEYS[access]),
            icon: IconLock,
            testId: 'database-form-share-access',
            opensPage: true,
            onClick: () => panel.push({
              title: i18n.t('tools.database.formSubmissionAccess'),
              returnFocus: 'database-form-share-access',
              build: () => ACCESS.map((choice) => panelRow({
                label: i18n.t(ACCESS_KEYS[choice]),
                testId: `database-form-share-access-${choice}`,
                checked: (options.settings().submissionAccess ?? 'none') === choice,
                onClick: () => {
                  options.update({ submissionAccess: choice === 'none' ? undefined : choice });
                  panel.back();
                },
              })),
            }),
          }),
        );
        if (host.link !== undefined && host.link !== '') rows.push(linkRow(i18n, host.link, options.copyLink));

        return rows;
      },
    },
  });

  return panel;
};

const linkRow = (i18n: Pick<I18n, 't'>, link: string, copy: (link: string) => void): HTMLElement => {
  const row = document.createElement('div');
  const field = document.createElement('input');
  const button = document.createElement('button');
  const icon = document.createElement('span');

  row.setAttribute('data-blok-database-form-share-link-row', '');
  field.type = 'text';
  field.readOnly = true;
  field.value = link;
  field.setAttribute('aria-label', i18n.t('tools.database.formLinkLabel'));
  field.setAttribute('data-blok-database-panel-input', '');
  field.setAttribute('data-blok-testid', 'database-form-share-link');
  button.type = 'button';
  button.setAttribute('data-blok-database-form-share-copy', '');
  button.setAttribute('data-blok-testid', 'database-form-share-copy');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = IconLink;
  button.append(icon, i18n.t('tools.database.formCopyLink'));
  button.addEventListener('click', () => copy(link));
  row.append(field, button);

  return row;
};
