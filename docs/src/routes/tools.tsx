import { Navigate, useLocation } from 'react-router-dom';

// Tools moved into the general docs page; keep old /tools links working.
const ToolsRedirect = () => {
  const { hash } = useLocation();
  const id = hash.replace(/^#/, '');
  return <Navigate to={id ? `/docs/${id}` : '/docs/paragraph'} replace />;
};

export default ToolsRedirect;
