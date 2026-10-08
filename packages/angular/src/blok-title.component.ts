import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  inject,
  type OnChanges,
  type OnDestroy,
  type SimpleChanges,
} from '@angular/core';
import type { Blok } from '@bloklabs/core';

/**
 * Places the editor's page title in this element, through `editor.title.mount`.
 * The editor needs `pageTitle` set; this only moves the title.
 * On destroy the title goes back above the first block. Projected content is not rendered.
 *
 * ```html
 * <blok-title [editor]="ed.instance()"></blok-title>
 * <blok-editor #ed="blok" [config]="{ pageTitle: true }"></blok-editor>
 * ```
 */
@Component({
  selector: 'blok-title',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class BlokTitleComponent implements OnChanges, OnDestroy {
  private readonly host: HTMLElement = inject(ElementRef<HTMLElement>).nativeElement;

  @Input() editor: Blok | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['editor'];

    if (change === undefined) {
      return;
    }
    release(change.previousValue as Blok | null | undefined);
    this.editor?.title.mount(this.host);
  }

  ngOnDestroy(): void {
    release(this.editor);
  }
}

const release = (editor: Blok | null | undefined): void => {
  // A destroyed editor has no title: destroy deletes its fields.
  const title = (editor as { title?: Partial<Blok['title']> } | null | undefined)?.title;

  if (typeof title?.mount === 'function') {
    title.mount(null);
  }
};
