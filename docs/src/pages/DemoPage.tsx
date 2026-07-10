import { useState, useCallback, useRef, useEffect } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { EditorWrapper } from '../components/demo/EditorWrapper';
import { OutputPanel } from '../components/demo/OutputPanel';
import { SettingsPanel } from '../components/demo/SettingsPanel';
import { DEFAULT_EDITOR_SETTINGS } from '../components/demo/editor-settings';
import { NAV_LINKS } from '../utils/constants';
import { useI18n } from '../contexts/I18nContext';
import { ShortcutKeys } from '../components/common/KeyIcon';
import { Typo } from '../components/common/Typo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BlokEditor {
  save: () => Promise<unknown>;
  clear: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  destroy?: () => void;
}

interface DemoContentProps {
  /** When embedded inline (homepage tab strip), tighten the top spacing. */
  inline?: boolean;
}

function useDemoEditor() {
  const { t, locale } = useI18n();
  const [showOutput, setShowOutput] = useState(false);
  const [output, setOutput] = useState<string>(() => t('demo.outputInitialMessage'));
  const editorRef = useRef<BlokEditor | null>(null);

  const emptyMessage = t('demo.outputInitialMessage');

  useEffect(() => {
    setOutput(prev => {
      try {
        JSON.parse(prev);
        return prev; // real JSON — keep it
      } catch {
        return emptyMessage; // placeholder — update to new locale
      }
    });
  }, [locale, emptyMessage]);

  const handleEditorReady = useCallback((editor: BlokEditor) => {
    editorRef.current = editor;
  }, []);

  const handleSave = useCallback(async () => {
    if (editorRef.current) {
      const data = await editorRef.current.save();
      setOutput(JSON.stringify(data, null, 2));
      setShowOutput(true);
    }
  }, []);

  const handleClear = useCallback(async () => {
    if (editorRef.current) {
      await editorRef.current.clear();
      setOutput(t('demo.editorCleared'));
    }
  }, [t]);

  const handleUndo = useCallback(async () => {
    if (editorRef.current) {
      await editorRef.current.undo();
    }
  }, []);

  const handleRedo = useCallback(async () => {
    if (editorRef.current) {
      await editorRef.current.redo();
    }
  }, []);

  return { t, showOutput, setShowOutput, output, handleEditorReady, handleSave, handleClear, handleUndo, handleRedo };
}

/** Traffic-light toolbar + Blok editor canvas + optional JSON output panel. */
const EditorCard: React.FC = () => {
  const { t, showOutput, setShowOutput, output, handleEditorReady, handleSave, handleClear, handleUndo, handleRedo } = useDemoEditor();

  return (
          <div className={cn('grid gap-6', showOutput ? 'lg:grid-cols-2' : 'grid-cols-1')}>
            <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
              <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  <span className="size-3 rounded-full bg-[#ff5f57]" />
                  <span className="size-3 rounded-full bg-[#febc2e]" />
                  <span className="size-3 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                  <Typo>{t('demo.editorTitle')}</Typo>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleUndo}
                    title={t('demo.undoTitle')}
                    aria-label={t('demo.undoAriaLabel')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7v6h6" />
                      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                    </svg>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleRedo}
                    title={t('demo.redoTitle')}
                    aria-label={t('demo.redoAriaLabel')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 7v6h-6" />
                      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
                    </svg>
                  </Button>
                  <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                    title={t('demo.getJsonTitle')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <span><Typo>{t('demo.getJsonLabel')}</Typo></span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleClear}
                    title={t('demo.clearTitle')}
                    className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-4 py-6 sm:px-8">
                <EditorWrapper onEditorReady={handleEditorReady} />
              </div>
            </div>

            {showOutput && (
              <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card">
                <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <Typo>{t('demo.jsonOutputTitle')}</Typo>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setShowOutput(false)}
                    title={t('demo.closeOutputTitle')}
                    aria-label={t('demo.closeOutputAriaLabel')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </Button>
                </div>
                <OutputPanel output={output} />
              </div>
            )}
          </div>
  );
};

/** The interactive playground body — editor + JSON output, no page chrome. */
export const DemoContent: React.FC<DemoContentProps> = ({ inline = false }) => {
  const { t } = useI18n();

  return (
    <div className={cn('mx-auto w-full max-w-6xl px-6', inline ? 'pt-8 pb-12 sm:pt-10' : 'py-12 sm:py-16')}>
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-primary">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              <Typo>{t('demo.badge')}</Typo>
            </span>
            <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
              <Typo>{t('demo.title')}</Typo> <span className="text-brand-gradient">{t('demo.titleGradient')}</span>
            </h1>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
              <Typo>{t('demo.subtitle')}</Typo>
              <code className="mx-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{t('demo.subtitleCommand')}</code>
              <Typo>{t('demo.subtitleRest')}</Typo>
            </p>
          </div>

          <EditorCard />

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm text-muted-foreground shadow-sm">
              <ShortcutKeys keys={['/']} />
              <span><Typo>{t('demo.tipOpenMenu')}</Typo></span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm text-muted-foreground shadow-sm">
              <ShortcutKeys keys={['Tab']} />
              <span><Typo>{t('demo.tipIndentList')}</Typo></span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm text-muted-foreground shadow-sm">
              <ShortcutKeys keys={['Ctrl', 'Z']} />
              <span>{t('demo.tipUndo')}</span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm text-muted-foreground shadow-sm">
              <ShortcutKeys keys={['Ctrl', 'B']} />
              <span><Typo>{t('demo.tipBoldText')}</Typo></span>
            </div>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover" data-hint-card>
              <div className="mb-4 inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div>
                <strong className="block text-base font-bold text-foreground"><Typo>{t('demo.hintInstantFeedbackTitle')}</Typo></strong>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground"><Typo>{t('demo.hintInstantFeedbackDesc')}</Typo></p>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover" data-hint-card>
              <div className="mb-4 inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              </div>
              <div>
                <strong className="block text-base font-bold text-foreground"><Typo>{t('demo.hintCleanJsonTitle')}</Typo></strong>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground"><Typo>{t('demo.hintCleanJsonDesc')}</Typo></p>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover" data-hint-card>
              <div className="mb-4 inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              </div>
              <div>
                <strong className="block text-base font-bold text-foreground"><Typo>{t('demo.hintBlockArchTitle')}</Typo></strong>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground"><Typo>{t('demo.hintBlockArchDesc')}</Typo></p>
              </div>
            </div>
          </div>
        </div>
  );
};

export const DemoPage: React.FC = () => {
  const { t } = useI18n();
  const [editorSettings, setEditorSettings] = useState(DEFAULT_EDITOR_SETTINGS);

  return (
    <>
      <div className="flex min-h-screen flex-col bg-background">
        <Nav links={NAV_LINKS} keepExpanded staticPosition />
        <main className="flex min-h-0 flex-1 flex-col">
          <h1 className="sr-only">
            <Typo>{t('demo.title')}</Typo> <Typo>{t('demo.titleGradient')}</Typo>
          </h1>
          {/* Below xl, keep the generous flat padding so the block toolbar's
              ~60px left gutter always has room. From xl up, the max-w-6xl box
              is wide enough that these padding values put the block content's
              left edge exactly under the Nav's logo (same px-4 outer / px-6
              inner / max-w-6xl centering math as Nav.tsx). */}
          <div
            className="min-h-0 w-full flex-1 overflow-auto px-6 pb-8 pt-10 sm:px-16 xl:px-4"
            data-blok-testid="demo-editor-container"
          >
            <div className="mx-auto w-full max-w-6xl px-6">
              <EditorWrapper settings={editorSettings} />
            </div>
          </div>
          <SettingsPanel settings={editorSettings} onSettingsChange={setEditorSettings} />
        </main>
      </div>
      <Footer />
    </>
  );
};
