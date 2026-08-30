// docs/src/components/server/ServerPathSection.tsx
import { CodeBlock } from '../common/CodeBlock';
import { Link } from '../common/Link';
import { Typo } from '../common/Typo';
import { useI18n } from '../../contexts/I18nContext';
import type { ServerCodeSample, ServerPath } from './server-data';

interface ServerPathSectionProps {
  section: ServerPath;
}

const SampleGroup: React.FC<{ heading: string; samples: ServerCodeSample[] }> = ({
  heading,
  samples,
}) => (
  <div className="mt-8">
    <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">{heading}</h3>
    <div className="flex flex-col gap-4">
      {samples.map((sample) => (
        <div key={sample.label}>
          <p className="mb-2 text-sm text-muted-foreground">
            <Typo>{sample.label}</Typo>
          </p>
          <CodeBlock code={sample.code} language={sample.language} />
        </div>
      ))}
    </div>
  </div>
);

export const ServerPathSection: React.FC<ServerPathSectionProps> = ({ section }) => {
  const { t } = useI18n();

  return (
    <section
      id={section.id}
      className="scroll-mt-24"
      data-blok-testid={`server-section-${section.id}`}
      aria-label={section.title}
    >
      <div className="mb-6">
        <h2 className="scroll-mt-24 text-2xl font-extrabold tracking-tight text-foreground">
          <Typo>{section.title}</Typo>
        </h2>
        <p className="mt-2 max-w-2xl text-base font-semibold leading-relaxed text-foreground">
          <Typo>{section.situation}</Typo>
        </p>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
          <Typo>{section.description}</Typo>
        </p>
      </div>

      {section.presetsPath !== undefined && (
        <Link
          to={section.presetsPath}
          className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-secondary/60"
        >
          {t('server.presetsLink')}
        </Link>
      )}

      {section.whatToRun.length > 0 && (
        <SampleGroup heading={t('server.whatToRun')} samples={section.whatToRun} />
      )}

      {section.appRoute.length > 0 && (
        <SampleGroup heading={t('server.appRoute')} samples={section.appRoute} />
      )}

      <SampleGroup heading={t('server.editorConfig')} samples={[section.editorConfig]} />

      <div className="mt-8">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">
          {t('server.failureModes')}
        </h3>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/60">
                <th className="px-4 py-3 font-semibold text-foreground">
                  {t('server.failureSymptom')}
                </th>
                <th className="px-4 py-3 font-semibold text-foreground">
                  {t('server.failureCause')}
                </th>
                <th className="px-4 py-3 font-semibold text-foreground">{t('server.failureFix')}</th>
              </tr>
            </thead>
            <tbody>
              {section.failureModes.map((mode) => (
                <tr key={mode.symptom} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 align-top font-medium text-foreground">
                    <Typo>{mode.symptom}</Typo>
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground">
                    <Typo>{mode.cause}</Typo>
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground">
                    <Typo>{mode.fix}</Typo>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
