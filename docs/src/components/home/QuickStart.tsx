import { useState } from "react";
import { CodeBlock } from "../common/CodeBlock";
import type { PackageManager } from "../common/PackageManagerToggle";

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

const STEPS = [
  {
    number: 1,
    title: "Install Blok",
    description: "Add Blok to your project using your favorite package manager.",
    accent: "coral",
  },
  {
    number: 2,
    title: "Import and configure",
    description: "Import the editor and tools, then configure your block types.",
    accent: "orange",
  },
  {
    number: 3,
    title: "Save content",
    description: "Extract clean JSON data ready to save anywhere.",
    accent: "pink",
  },
];

export const QuickStart: React.FC = () => {
  const [packageManager, setPackageManager] = useState<PackageManager>("yarn");

  // Default install command (fallback, will be overridden by CodeBlock)
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
    <section className="quick-start" id="quick-start" data-blok-testid="quick-start-section">
      {/* Enhanced background with multiple decorative elements */}
      <div className="quick-start-bg" data-blok-testid="quick-start-bg">
        <div className="quick-start-blur quick-start-blur--primary" data-blok-testid="quick-start-blur"></div>
        <div className="quick-start-blur quick-start-blur--secondary"></div>
        <div className="quick-start-grid-pattern"></div>
        {/* Floating decorative shapes */}
        <div className="quick-start-shape quick-start-shape--1"></div>
        <div className="quick-start-shape quick-start-shape--2"></div>
        <div className="quick-start-shape quick-start-shape--3"></div>
      </div>
      
      <div className="container">
        <div className="section-header quick-start-header">
          <span className="section-eyebrow">Get Started</span>
          <h2 className="section-title">Up and running in minutes</h2>
          <p className="section-description">Three simple steps to integrate Blok into your project</p>
        </div>
        
        <div className="install-steps" data-blok-testid="install-steps">
          {/* Timeline connector - visual line between steps */}
          <div className="install-steps-timeline" aria-hidden="true">
            <div className="timeline-line"></div>
            <div className="timeline-progress"></div>
          </div>
          
          {STEPS.map((step, index) => (
            <div
              key={step.number}
              className={`install-step install-step--${step.accent}`}
              data-blok-testid={`install-step-${step.number}`}
              style={{ "--step-delay": `${index * 0.15}s` } as React.CSSProperties}
            >
              <div className="step-indicator" data-blok-testid={`step-number-${step.number}`}>
                <div className="step-number">
                  <span>{step.number}</span>
                </div>
              </div>
              
              <div className="step-card" data-blok-testid={`step-content-${step.number}`}>
                <div className="step-card-glow"></div>
                <div className="step-card-content">
                  <h3 className="step-title">{step.title}</h3>
                  <p className="step-description" data-blok-testid={`step-description-${step.number}`}>
                    {step.description}
                  </p>
                  
                  {step.number === 1 && (
                    <CodeBlock
                      code={getInstallCommand(packageManager)}
                      language="bash"
                      showPackageManagerToggle
                      packageName={PACKAGE_NAME}
                      onPackageManagerChange={setPackageManager}
                    />
                  )}
                  {step.number === 2 && (
                    <CodeBlock code={CONFIG_CODE} language="typescript" />
                  )}
                  {step.number === 3 && (
                    <CodeBlock code={SAVE_CODE} language="typescript" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
