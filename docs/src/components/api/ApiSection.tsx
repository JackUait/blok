import { CodeBlock } from '../common/CodeBlock';
import { ApiSection as ApiSectionType } from './api-data';

interface ApiSectionProps {
  section: ApiSectionType;
}

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

const QuickStartContent: React.FC = () => {
  return (
    <div className="api-quickstart">
      <div className="api-quickstart-step">
        <div className="api-quickstart-number">1</div>
        <div className="api-quickstart-content">
          <h3>Install Blok</h3>
          <p>Add Blok to your project using your favorite package manager.</p>
          <CodeBlock code={INSTALL_CODE} language="bash" />
        </div>
      </div>
      <div className="api-quickstart-step">
        <div className="api-quickstart-number">2</div>
        <div className="api-quickstart-content">
          <h3>Import and configure</h3>
          <p>Import the editor and tools, then configure your block types.</p>
          <CodeBlock code={CONFIG_CODE} language="typescript" />
        </div>
      </div>
      <div className="api-quickstart-step">
        <div className="api-quickstart-number">3</div>
        <div className="api-quickstart-content">
          <h3>Save content</h3>
          <p>Extract clean JSON data ready to save anywhere.</p>
          <CodeBlock code={SAVE_CODE} language="javascript" />
        </div>
      </div>
    </div>
  );
};

export const ApiSection: React.FC<ApiSectionProps> = ({ section }) => {
  // Render quick-start content specially
  if (section.customType === 'quick-start') {
    return (
      <section id={section.id} className="api-section">
        <div className="api-section-header">
          {section.badge && <div className="api-section-badge">{section.badge}</div>}
          <h1 className="api-section-title">{section.title}</h1>
          {section.description && (
            <p className="api-section-description">{section.description}</p>
          )}
        </div>
        <QuickStartContent />
      </section>
    );
  }

  return (
    <section id={section.id} className="api-section">
      <div className="api-section-header">
        {section.badge && <div className="api-section-badge">{section.badge}</div>}
        <h1 className="api-section-title">{section.title}</h1>
        {section.description && (
          <p className="api-section-description">{section.description}</p>
        )}
      </div>

      {section.methods && section.methods.length > 0 && (
        <div className="api-block">
          <h3 className="api-block-title">Methods</h3>
          {section.methods.map((method, index) => (
            <div key={index} className="api-method-large">
              <div className="api-method-header">
                <span className="api-method-name">{method.name}</span>
                <span className="api-method-return">{method.returnType}</span>
              </div>
              <p className="api-method-description">{method.description}</p>
              {method.example && (
                <CodeBlock code={method.example} language="typescript" />
              )}
            </div>
          ))}
        </div>
      )}

      {section.properties && section.properties.length > 0 && (
        <div className="api-block">
          <h3 className="api-block-title">Properties</h3>
          <table className="api-table">
            <thead>
              <tr>
                <th>Property</th>
                <th>Type</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {section.properties.map((prop) => (
                <tr key={prop.name}>
                  <td>
                    <code>{prop.name}</code>
                  </td>
                  <td>
                    <code>{prop.type}</code>
                  </td>
                  <td>{prop.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section.table && section.table.length > 0 && (
        <div className="api-block">
          <h3 className="api-block-title">{section.title}</h3>
          <table className="api-table">
            <thead>
              <tr>
                {section.id === 'config' && <th>Option</th>}
                <th>{section.id === 'config' ? 'Type' : 'Property'}</th>
                {section.id === 'config' && <th>Default</th>}
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {section.table.map((row) => (
                <tr key={row.option}>
                  <td>
                    <code>{row.option}</code>
                  </td>
                  <td>
                    <code>{row.type}</code>
                  </td>
                  {section.id === 'config' && (
                    <td>
                      <code>{row.default}</code>
                    </td>
                  )}
                  <td>{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
