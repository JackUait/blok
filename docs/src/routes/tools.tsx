import { Navigate, useLocation } from 'react-router-dom';
import { useLocalizedHref } from '../contexts/I18nContext';

// Tools moved into the general docs page; keep old /tools links working. The
// destination is mapped into the reader's locale tree, so /ru/tools cannot dump
// a Russian reader onto the English page (its canonical points at /ru too).
const ToolsRedirect = () => {
  const { hash } = useLocation();
  const localizedHref = useLocalizedHref();
  const id = hash.replace(/^#/, '');
  return <Navigate to={localizedHref(id ? `/docs/${id}` : '/docs/paragraph')} replace />;
};

export default ToolsRedirect;
