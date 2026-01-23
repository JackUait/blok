import { SIDEBAR_SECTIONS } from './api-data';

interface ApiSidebarProps {
  activeSection: string;
}

export const ApiSidebar: React.FC<ApiSidebarProps> = ({ activeSection }) => {
  const scrollToSection = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <aside className="api-sidebar" data-api-sidebar>
      <nav className="api-sidebar-nav">
        {SIDEBAR_SECTIONS.map((section) => (
          <div key={section.title} className="api-sidebar-section">
            <h4 className="api-sidebar-title">{section.title}</h4>
            {section.links.map((link) => (
              <a
                key={link.id}
                href={`#${link.id}`}
                className={`api-sidebar-link ${activeSection === link.id ? 'active' : ''}`}
                onClick={scrollToSection(link.id)}
              >
                {link.label}
              </a>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
};
