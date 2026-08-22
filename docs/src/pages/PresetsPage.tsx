// docs/src/pages/PresetsPage.tsx
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Typo } from '../components/common/Typo';
import { PresetSection } from '../components/presets/PresetSection';
import { presets } from '../components/presets/presets-data';
import { NAV_LINKS } from '../utils/constants';

/** The storage-presets documentation body — summary table, then one section per preset. */
export const PresetsContent: React.FC = () => (
  <div className="mx-auto w-full max-w-4xl px-6 py-10 lg:py-14" data-blok-testid="presets-docs">
    <div className="mb-10">
      <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
        Storage presets
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
        <Typo>
          Ready-made uploaders from @bloklabs/presets, so Blok has somewhere to put uploaded files without you
          writing an upload handler. Each one plugs into the uploader config option directly.
        </Typo>
      </p>
    </div>

    <div className="mb-12 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <table className="w-full border-collapse text-left text-sm" data-blok-testid="presets-table">
        <thead>
          <tr className="border-b border-border bg-secondary/60">
            <th className="px-4 py-3 font-semibold text-foreground">Preset</th>
            <th className="px-4 py-3 font-semibold text-foreground">Re-hosts a remote URL?</th>
            <th className="px-4 py-3 font-semibold text-foreground">Production-ready?</th>
          </tr>
        </thead>
        <tbody>
          {presets.map((preset) => (
            <tr
              key={preset.id}
              className="border-b border-border last:border-0"
              data-blok-testid={`presets-summary-${preset.id}`}
            >
              <td className="px-4 py-3 align-top">
                <a href={`#${preset.id}`} className="font-semibold text-foreground hover:underline">
                  {preset.title}
                </a>
              </td>
              <td className="px-4 py-3 align-top text-muted-foreground">
                {preset.supportsUploadByUrl ? 'Yes' : 'No'}
              </td>
              <td className="px-4 py-3 align-top text-muted-foreground">
                {preset.productionReady ? 'Yes' : 'No'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <div className="flex flex-col gap-16">
      {presets.map((preset) => (
        <PresetSection key={preset.id} section={preset} />
      ))}
    </div>
  </div>
);

export const PresetsPage: React.FC = () => (
  <>
    <Nav links={NAV_LINKS} />
    <main className="min-h-screen bg-background pt-16">
      <PresetsContent />
    </main>
    <Footer />
  </>
);
