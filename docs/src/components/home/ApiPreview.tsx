import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../../contexts/I18nContext";
import { Button } from "@/components/ui/button";

interface ApiMethod {
  name: string;
  description: string;
  /** Anchor ID for linking to the specific method in the docs */
  anchor: string;
}

interface ApiCard {
  title: string;
  icon: React.ReactNode;
  accentColor: string;
  docSection: string;
  methods: ApiMethod[];
}

const IconBolt: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const IconBlocks: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const IconBroadcast: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" />
    <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
  </svg>
);

export const ApiPreview: React.FC = () => {
  const { t } = useI18n();

  const API_DATA = useMemo<ApiCard[]>(() => [
    {
      title: t('home.apiPreview.coreMethods.title'),
      icon: <IconBolt />,
      accentColor: "coral",
      docSection: "core",
      methods: [
        {
          name: "save()",
          description: t('home.apiPreview.coreMethods.save'),
          anchor: "core-save",
        },
        {
          name: "render(data)",
          description: t('home.apiPreview.coreMethods.render'),
          anchor: "core-render",
        },
        {
          name: "focus()",
          description: t('home.apiPreview.coreMethods.focus'),
          anchor: "core-focus",
        },
        {
          name: "clear()",
          description: t('home.apiPreview.coreMethods.clear'),
          anchor: "core-clear",
        },
      ],
    },
    {
      title: t('home.apiPreview.blocksApi.title'),
      icon: <IconBlocks />,
      accentColor: "green",
      docSection: "blocks-api",
      methods: [
        {
          name: "blocks.delete()",
          description: t('home.apiPreview.blocksApi.delete'),
          anchor: "blocks-api-blocks-delete",
        },
        {
          name: "blocks.insert()",
          description: t('home.apiPreview.blocksApi.insert'),
          anchor: "blocks-api-blocks-insert",
        },
        {
          name: "blocks.move()",
          description: t('home.apiPreview.blocksApi.move'),
          anchor: "blocks-api-blocks-move",
        },
        {
          name: "blocks.update()",
          description: t('home.apiPreview.blocksApi.update'),
          anchor: "blocks-api-blocks-update",
        },
      ],
    },
    {
      title: t('home.apiPreview.events.title'),
      icon: <IconBroadcast />,
      accentColor: "pink",
      docSection: "events-api",
      methods: [
        {
          name: "on(event, fn)",
          description: t('home.apiPreview.events.on'),
          anchor: "events-api-on",
        },
        {
          name: "off(event, fn)",
          description: t('home.apiPreview.events.off'),
          anchor: "events-api-off",
        },
        {
          name: "emit(event, data)",
          description: t('home.apiPreview.events.emit'),
          anchor: "events-api-emit",
        },
      ],
    },
  ], [t]);

  return (
    <section className="py-20 sm:py-28" id="api" data-blok-testid="api-preview-section">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-wide text-primary">
            {t('home.apiPreview.eyebrow')}
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t('home.apiPreview.title1')}
            <br />
            {t('home.apiPreview.title2')}
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            {t('home.apiPreview.description')}
          </p>
        </div>
        <div
          className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3"
          data-blok-testid="api-grid"
        >
          {API_DATA.map((card, index) => (
            <div
              key={card.title}
              className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
              data-blok-testid={`api-card-${card.title.toLowerCase().replace(" ", "-")}`}
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div
                className="flex items-center gap-3 border-b border-border px-5 py-4"
                data-blok-testid="api-card-header"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {card.icon}
                </span>
                <h3 className="text-base font-bold tracking-tight">{card.title}</h3>
              </div>
              <div
                className="flex flex-col divide-y divide-border"
                data-blok-testid="api-card-content"
              >
                {card.methods.map((method) => (
                  <Link
                    key={method.name}
                    to={`/docs#${method.anchor}`}
                    className="group flex flex-col gap-1 px-5 py-3.5 transition-colors hover:bg-secondary/60"
                    data-blok-testid="api-method"
                  >
                    <span className="font-mono text-sm font-semibold text-foreground group-hover:text-primary">
                      {method.name}
                    </span>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {method.description}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-12 flex justify-center" data-blok-testid="api-cta">
          <Button variant="outline" size="lg" asChild>
            <Link to="/docs">{t('home.apiPreview.viewFullDocs')}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
};
