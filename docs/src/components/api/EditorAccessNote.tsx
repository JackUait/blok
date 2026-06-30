import { CodeBlock } from '../common/CodeBlock';
import { useI18n } from '../../contexts/I18nContext';
import { useFramework } from '../../contexts/FrameworkContext';
import { EDITOR_ACCESS_SNIPPETS } from '../common/framework-snippets';

/**
 * Framework-aware preamble for API pages whose method examples call into a live
 * `editor` instance. The examples are identical across frameworks once you hold
 * a reference — only how you reach it differs — so this note shows that one
 * framework-specific step and leaves the method bodies untouched. Driven by the
 * global FrameworkContext, so it follows the sidebar toggle page to page.
 */
export const EditorAccessNote: React.FC = () => {
  const { t } = useI18n();
  const { framework } = useFramework();
  const snippet = EDITOR_ACCESS_SNIPPETS[framework];

  return (
    <div
      className="rounded-2xl border border-border bg-secondary/30 p-5"
      data-blok-testid="editor-access-note"
    >
      <h3 className="font-display text-sm font-bold tracking-tight text-foreground">
        {t('frameworkToggle.editorAccess.heading')}
      </h3>
      <p className="mt-1 mb-4 text-sm leading-relaxed text-muted-foreground">
        {t(`frameworkToggle.editorAccess.${framework}`)}
      </p>
      <CodeBlock code={snippet.code} language={snippet.language} />
    </div>
  );
};
