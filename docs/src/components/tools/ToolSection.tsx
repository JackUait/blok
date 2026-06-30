// docs/src/components/tools/ToolSection.tsx
import { CodeBlock } from '../common/CodeBlock';
import { CategoryIcon } from '../common/CategoryIcon';
import { Typo } from '../common/Typo';
import type { ToolSection as ToolSectionType } from './tools-data';
import { useI18n } from '../../contexts/I18nContext';
import { useFramework } from '../../contexts/FrameworkContext';
import { adaptExample } from '../common/framework-adapt';

interface ToolSectionProps {
  section: ToolSectionType;
}

export const ToolSection: React.FC<ToolSectionProps> = ({ section }) => {
  const { t } = useI18n();
  const { framework } = useFramework();
  const usage = adaptExample(section.usageExample, framework);

  return (
    <section
      id={section.id}
      className="scroll-mt-24"
      data-blok-testid={`tools-section-${section.id}`}
      aria-label={section.title}
    >
      <div className="mb-8">
        <div
          className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary"
          data-blok-testid="tools-section-badge"
        >
          <CategoryIcon category={section.type} size={14} />
          <Typo>{section.badge}</Typo>
        </div>
        <h1 className="scroll-mt-24 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          {section.title}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
          <Typo>{section.description}</Typo>
        </p>
      </div>

      <div className="mt-8">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">
          {t('tools.import')}
        </h3>
        <CodeBlock code={section.importExample} language="typescript" />
      </div>

      {section.configOptions.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">
            {t('tools.configuration')}
          </h3>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/60">
                  <th className="px-4 py-3 font-semibold text-foreground">{t('tools.option')}</th>
                  <th className="px-4 py-3 font-semibold text-foreground">{t('tools.type')}</th>
                  <th className="px-4 py-3 font-semibold text-foreground">{t('tools.default')}</th>
                  <th className="px-4 py-3 font-semibold text-foreground">{t('tools.description')}</th>
                </tr>
              </thead>
              <tbody>
                {section.configOptions.map((opt) => (
                  <tr
                    key={opt.option}
                    className="border-b border-border last:border-0 transition-colors hover:bg-secondary/40"
                    data-blok-testid={`tools-config-${section.id}-${opt.option}`}
                  >
                    <td className="px-4 py-3 align-top"><code className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs text-primary">{opt.option}</code></td>
                    <td className="px-4 py-3 align-top"><code className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">{opt.type}</code></td>
                    <td className="px-4 py-3 align-top"><code className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{opt.default}</code></td>
                    <td className="px-4 py-3 align-top text-muted-foreground"><Typo>{opt.description}</Typo></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-3">
        <h3 className="mb-0 text-sm font-bold uppercase tracking-wide text-foreground">
          <Typo>{t('tools.saveData')}</Typo>
        </h3>
        <CodeBlock code={section.saveDataShape} language="typescript" />
        <CodeBlock code={section.saveDataExample} language="json" />
      </div>

      <div className="mt-8">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">
          <Typo>{t('tools.usageExample')}</Typo>
        </h3>
        <CodeBlock code={usage.code} language={usage.language} />
      </div>
    </section>
  );
};
