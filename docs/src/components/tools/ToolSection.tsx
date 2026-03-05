// docs/src/components/tools/ToolSection.tsx
import { CodeBlock } from '../common/CodeBlock';
import { CategoryIcon } from '../common/CategoryIcon';
import type { ToolSection as ToolSectionType } from './tools-data';
import { useI18n } from '../../contexts/I18nContext';

interface ToolSectionProps {
  section: ToolSectionType;
}

export const ToolSection: React.FC<ToolSectionProps> = ({ section }) => {
  const { t } = useI18n();

  return (
    <section
      id={section.id}
      className="tools-section"
      data-blok-testid={`tools-section-${section.id}`}
      aria-label={section.title}
    >
      <div className="tools-section-header">
        <div className="tools-section-badge" data-blok-testid="tools-section-badge">
          <CategoryIcon category={section.type} size={14} />
          {section.badge}
        </div>
        <h1 className="tools-section-title">
          <a
            href={`#${section.id}`}
            className="tools-anchor-link"
            aria-label={`Link to ${section.title}`}
          >
            #
          </a>
          {section.title}
        </h1>
        <p className="tools-section-description">{section.description}</p>
      </div>

      <div className="tools-block">
        <h3 className="tools-block-title">{t('tools.import')}</h3>
        <CodeBlock code={section.importExample} language="typescript" />
      </div>

      {section.configOptions.length > 0 && (
        <div className="tools-block">
          <h3 className="tools-block-title">{t('tools.configuration')}</h3>
          <table className="tools-table tools-table--with-anchors">
            <thead>
              <tr>
                <th>{t('tools.option')}</th>
                <th>{t('tools.type')}</th>
                <th>{t('tools.default')}</th>
                <th>{t('tools.description')}</th>
              </tr>
            </thead>
            <tbody>
              {section.configOptions.map((opt) => (
                <tr
                  key={opt.option}
                  className="tools-table-row"
                  data-blok-testid={`tools-config-${section.id}-${opt.option}`}
                >
                  <td><code>{opt.option}</code></td>
                  <td><code>{opt.type}</code></td>
                  <td><code>{opt.default}</code></td>
                  <td>{opt.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="tools-block">
        <h3 className="tools-block-title">{t('tools.saveData')}</h3>
        <CodeBlock code={section.saveDataShape} language="typescript" />
        <CodeBlock code={section.saveDataExample} language="json" />
      </div>

      <div className="tools-block">
        <h3 className="tools-block-title">{t('tools.usageExample')}</h3>
        <CodeBlock code={section.usageExample} language="typescript" />
      </div>
    </section>
  );
};
