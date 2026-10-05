import { useLocation } from 'react-router';
import { currentVersionId } from './versions';
import { stringsFor } from './strings';

export const VersionBanner = () => {
  const { pathname } = useLocation();
  if (import.meta.env.BASE_URL === '/') return null;

  const strings = stringsFor(pathname);
  const id = currentVersionId();
  const ru = strings === stringsFor('/ru');

  return (
    <div
      role="status"
      className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-6 py-1.5 text-center text-[13px] font-medium text-muted-foreground"
    >
      <span>{id === 'next' ? strings.unreleased : strings.archive(id)}</span>
      {/* A plain <a>: the latest version is a different app, so the router must not handle it. */}
      <a href={ru ? '/ru/' : '/'} className="font-semibold text-foreground underline underline-offset-2">
        {strings.toLatest}
      </a>
    </div>
  );
};
