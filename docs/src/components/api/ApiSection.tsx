import { useState } from "react";
import { CodeBlock } from "../common/CodeBlock";
import { CategoryIcon } from "../common/CategoryIcon";
import { ApiMethodCard } from "./ApiMethodCard";
import { useI18n } from "../../contexts/I18nContext";
import type { ApiSection as ApiSectionType } from "./api-data";
import type { PackageManager } from "../common/PackageManagerToggle";

interface ApiSectionProps {
  section: ApiSectionType;
}

/**
 * Generate a URL-safe anchor ID from a property or option name
 * e.g., "isReady" -> "core-prop-isready"
 */
const generatePropertyId = (sectionId: string, propName: string): string => {
  const cleanName = propName
    .replace(/[.]+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  return `${sectionId}-prop-${cleanName}`;
};

/**
 * Generate a URL-safe anchor ID from a config option name
 * e.g., "holder" -> "config-holder"
 */
const generateOptionId = (sectionId: string, optionName: string): string => {
  const cleanName = optionName.toLowerCase();
  return `${sectionId}-${cleanName}`;
};

const PACKAGE_NAME = "@jackuait/blok";

const CONFIG_CODE = `import { Blok } from '@jackuait/blok';
import { Header, Paragraph, List, Bold, Italic, Link } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    paragraph: Paragraph,
    header: { class: Header, placeholder: 'Enter a heading' },
    list: List,
    bold: Bold,
    italic: Italic,
    link: Link,
  },
});`;

const SAVE_CODE = `const data = await editor.save();`;

const QuickStartContent: React.FC = () => {
  const { t } = useI18n();
  const [packageManager, setPackageManager] = useState<PackageManager>("yarn");

  const getInstallCommand = (manager: PackageManager): string => {
    switch (manager) {
      case "yarn":
        return `yarn add ${PACKAGE_NAME}`;
      case "npm":
        return `npm install ${PACKAGE_NAME}`;
      case "bun":
        return `bun add ${PACKAGE_NAME}`;
      default:
        return `npm install ${PACKAGE_NAME}`;
    }
  };

  return (
    <div className="api-quickstart">
      <div className="api-quickstart-step">
        <div className="api-quickstart-content">
          <h3>{t('api.quickStartSteps.install.title')}</h3>
          <p>{t('api.quickStartSteps.install.description')}</p>
          <CodeBlock
            code={getInstallCommand(packageManager)}
            language="bash"
            showPackageManagerToggle
            packageName={PACKAGE_NAME}
            onPackageManagerChange={setPackageManager}
          />
        </div>
      </div>
      <div className="api-quickstart-step">
        <div className="api-quickstart-content">
          <h3>{t('api.quickStartSteps.configure.title')}</h3>
          <p>{t('api.quickStartSteps.configure.description')}</p>
          <CodeBlock code={CONFIG_CODE} language="typescript" />
        </div>
      </div>
      <div className="api-quickstart-step">
        <div className="api-quickstart-content">
          <h3>{t('api.quickStartSteps.save.title')}</h3>
          <p>{t('api.quickStartSteps.save.description')}</p>
          <CodeBlock code={SAVE_CODE} language="typescript" />
        </div>
      </div>
    </div>
  );
};

export const ApiSection: React.FC<ApiSectionProps> = ({ section }) => {
  const { t } = useI18n();
  
  // Render quick-start content specially
  if (section.customType === "quick-start") {
    return (
      <section id={section.id} className="api-section" data-blok-testid={section.id} aria-label={section.title}>
        <div className="api-section-header">
          {section.badge && (
            <div className="api-section-badge" data-blok-testid="api-section-badge">
              <CategoryIcon category={section.badge} size={14} />
              {section.badge}
            </div>
          )}
          <h1 className="api-section-title">
            <a href={`#${section.id}`} className="api-anchor-link" aria-label={`Link to ${section.title}`}>#</a>
            {section.title}
          </h1>
          {section.description && (
            <p className="api-section-description">{section.description}</p>
          )}
        </div>
        <QuickStartContent />
      </section>
    );
  }

  return (
    <section id={section.id} className="api-section" data-blok-testid={section.id} aria-label={section.title}>
      <div className="api-section-header">
        {section.badge && (
          <div className="api-section-badge" data-blok-testid="api-section-badge">
            <CategoryIcon category={section.badge} size={14} />
            {section.badge}
          </div>
        )}
        <h1 className="api-section-title">
          <a href={`#${section.id}`} className="api-anchor-link" aria-label={`Link to ${section.title}`}>#</a>
          {section.title}
        </h1>
        {section.description && (
          <p className="api-section-description">{section.description}</p>
        )}
      </div>

      {section.methods && section.methods.length > 0 && (
        <div className="api-block">
          <h3 className="api-block-title">{t('api.methods')}</h3>
          {section.methods.map((method, index) => (
            <ApiMethodCard key={index} method={method} sectionId={section.id} />
          ))}
        </div>
      )}

      {section.properties && section.properties.length > 0 && (
        <div className="api-block">
          <h3 className="api-block-title">{t('api.properties')}</h3>
          <table className="api-table api-table--with-anchors">
            <thead>
              <tr>
                <th>{t('api.property')}</th>
                <th>{t('api.type')}</th>
                <th>{t('api.description')}</th>
              </tr>
            </thead>
            <tbody>
              {section.properties.map((prop) => {
                const propId = generatePropertyId(section.id, prop.name);
                return (
                  <tr key={prop.name} id={propId} className="api-table-row" data-blok-testid={propId}>
                    <td>
                      <a href={`#${propId}`} className="api-anchor-link api-anchor-link--table" aria-label={`Link to ${prop.name}`}>#</a>
                      <code>{prop.name}</code>
                    </td>
                    <td>
                      <code>{prop.type}</code>
                    </td>
                    <td>{prop.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {section.example && (
        <div className="api-block">
          <CodeBlock code={section.example} language="typescript" />
        </div>
      )}

      {section.table && section.table.length > 0 && (
        <div className="api-block">
          <h3 className="api-block-title">{section.title}</h3>
          <table className="api-table api-table--with-anchors">
            <thead>
              <tr>
                {section.id === "config" && <th>{t('api.option')}</th>}
                <th>{section.id === "config" ? t('api.type') : t('api.property')}</th>
                {section.id === "config" && <th>{t('api.default')}</th>}
                <th>{t('api.description')}</th>
              </tr>
            </thead>
            <tbody>
              {section.table.map((row) => {
                const optionId = generateOptionId(section.id, row.option);
                return (
                  <tr key={row.option} id={optionId} className="api-table-row" data-blok-testid={optionId}>
                    <td>
                      <a href={`#${optionId}`} className="api-anchor-link api-anchor-link--table" aria-label={`Link to ${row.option}`}>#</a>
                      <code>{row.option}</code>
                    </td>
                    <td>
                      <code>{row.type}</code>
                    </td>
                    {section.id === "config" && (
                      <td>
                        <code>{row.default}</code>
                      </td>
                    )}
                    <td>{row.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
