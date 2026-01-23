import { CodeBlock } from '../common/CodeBlock';

const INSTALL_CODE = 'npm install @jackuait/blok';

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

const SAVE_CODE = `const data = await editor.save();
// {
//   "version": "0.5.0",
//   "time": 1642697600000,
//   "blocks": [
//     {
//       "id": "abc123",
//       "type": "paragraph",
//       "data": { "text": "Hello World" }
//     }
//   ]
// }`;

export const QuickStart: React.FC = () => {
  return (
    <section className="quick-start" id="quick-start">
      <div className="quick-start-bg">
        <div className="quick-start-blur"></div>
      </div>
      <div className="container">
        <div className="section-header">
          <p className="section-eyebrow">Quick Start</p>
          <h2 className="section-title">
            Up and running
            <br />
            in minutes
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
              <CodeBlock code={INSTALL_CODE} language="bash" />
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
