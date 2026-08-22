// docs/src/components/presets/PresetSection.tsx
import { CodeBlock } from '../common/CodeBlock';
import { Typo } from '../common/Typo';
import type { PresetSection as PresetSectionType } from './presets-data';

interface PresetSectionProps {
  section: PresetSectionType;
}

export const PresetSection: React.FC<PresetSectionProps> = ({ section }) => (
  <section
    id={section.id}
    className="scroll-mt-24"
    data-blok-testid={`presets-section-${section.id}`}
    aria-label={section.title}
  >
    <div className="mb-6">
      <h2 className="scroll-mt-24 text-2xl font-extrabold tracking-tight text-foreground">
        <Typo>{section.title}</Typo>
      </h2>
      <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
        <Typo>{section.description}</Typo>
      </p>
    </div>

    <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm font-bold uppercase tracking-wide text-foreground">Re-hosting a remote URL</p>
      <p className="mt-2 text-sm text-muted-foreground">
        <Typo>{section.uploadByUrlNote}</Typo>
      </p>
    </div>

    {!section.productionReady && section.productionNote && (
      <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm font-bold uppercase tracking-wide text-destructive">Not for production</p>
        <p className="mt-2 text-sm text-muted-foreground">
          <Typo>{section.productionNote}</Typo>
        </p>
      </div>
    )}

    {section.configOptions.length > 0 && (
      <div className="mt-6">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">Configuration</h3>
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/60">
                <th className="px-4 py-3 font-semibold text-foreground">Option</th>
                <th className="px-4 py-3 font-semibold text-foreground">Type</th>
                <th className="px-4 py-3 font-semibold text-foreground">Default</th>
                <th className="px-4 py-3 font-semibold text-foreground">Description</th>
              </tr>
            </thead>
            <tbody>
              {section.configOptions.map((opt) => (
                <tr
                  key={opt.option}
                  className="border-b border-border last:border-0 transition-colors hover:bg-secondary/40"
                  data-blok-testid={`presets-config-${section.id}-${opt.option}`}
                >
                  <td className="px-4 py-3 align-top">
                    <code className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs text-primary">
                      {opt.option}
                    </code>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <code className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
                      {opt.type}
                    </code>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <code className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {opt.default}
                    </code>
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground">
                    <Typo>{opt.description}</Typo>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )}

    <div className="mt-6">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">Storage-side setup</h3>
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        {section.storageSetup.map((step) => (
          <li key={step}>
            <Typo>{step}</Typo>
          </li>
        ))}
      </ul>
    </div>

    <div className="mt-6">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">Usage</h3>
      <CodeBlock code={section.usageExample} language="typescript" />
    </div>
  </section>
);
