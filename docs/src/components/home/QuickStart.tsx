import { useState } from 'react';
import { CodeBlock } from '../common/CodeBlock';
import type { PackageManager } from '../common/PackageManagerToggle';

const PACKAGE_NAME = '@jackuait/blok';

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

export const QuickStart: React.FC = () => {
  const [packageManager, setPackageManager] = useState<PackageManager>('yarn');

  // Default install command (fallback, will be overridden by CodeBlock)
  const getInstallCommand = (manager: PackageManager): string => {
    switch (manager) {
      case 'yarn':
        return `yarn add ${PACKAGE_NAME}`;
      case 'npm':
        return `npm install ${PACKAGE_NAME}`;
      case 'bun':
        return `bun add ${PACKAGE_NAME}`;
      default:
        return `npm install ${PACKAGE_NAME}`;
    }
  };

  return (
    <section className="quick-start" id="quick-start">
      <div className="quick-start-bg">
        <div className="quick-start-blur"></div>
      </div>
      <div className="container">
        <div className="section-header">
          <h2 className="section-title">
            Up and running in minutes
          </h2>
        </div>
        <div className="install-steps">
          <div
            className="install-step"
            data-install-step
            style={{ animationDelay: '0s' }}
          >
            <div className="step-number">
              <span>1</span>
            </div>
            <div className="step-content">
              <h3 className="step-title">Install Blok</h3>
              <p className="step-description">
                Add Blok to your project using your favorite package manager.
              </p>
              <CodeBlock
                code={getInstallCommand(packageManager)}
                language="bash"
                showPackageManagerToggle
                packageName={PACKAGE_NAME}
                onPackageManagerChange={setPackageManager}
              />
            </div>
          </div>
          <div
            className="install-step"
            data-install-step
            style={{ animationDelay: '0.1s' }}
          >
            <div className="step-number">
              <span>2</span>
            </div>
            <div className="step-content">
              <h3 className="step-title">Import and configure</h3>
              <p className="step-description">
                Import the editor and tools, then configure your block types.
              </p>
              <CodeBlock code={CONFIG_CODE} language="typescript" />
            </div>
          </div>
          <div
            className="install-step"
            data-install-step
            style={{ animationDelay: '0.2s' }}
          >
            <div className="step-number">
              <span>3</span>
            </div>
            <div className="step-content">
              <h3 className="step-title">Save content</h3>
              <p className="step-description">Extract clean JSON data ready to save anywhere.</p>
              <CodeBlock code={SAVE_CODE} language="javascript" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
