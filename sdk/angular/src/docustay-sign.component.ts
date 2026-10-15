import { Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from "@angular/core";
import "@docustay2026/embed";
import type { DocustayEventDetail, DocustayEventType } from "@docustay2026/embed";

/**
 * <docustay-sign-form [url]="session.url" (completed)="done($event)"></docustay-sign-form>
 * `url` comes from POST /api/v1/documents/{id}/embed-session, called from YOUR server.
 * Outputs: ready, waiting, completed, declined, error, resize (each { documentId, … }) and `docustayEvent` (every event as { type, documentId, … }).
 */
@Component({
  selector: "docustay-sign-form",
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<docustay-sign #el [attr.url]="url" [attr.height]="height ?? null" [attr.auto-height]="autoHeight ? '' : null" [attr.title]="title ?? null"></docustay-sign>`,
})
export class DocustaySignComponent implements OnInit, OnDestroy {
  @Input({ required: true }) url!: string;
  @Input() height?: number | string;
  @Input() autoHeight = false;
  @Input() title?: string;
  @Output() ready = new EventEmitter<DocustayEventDetail>();
  @Output() waiting = new EventEmitter<DocustayEventDetail>();
  @Output() completed = new EventEmitter<DocustayEventDetail>();
  @Output() declined = new EventEmitter<DocustayEventDetail>();
  @Output() error = new EventEmitter<DocustayEventDetail>();
  @Output() resize = new EventEmitter<DocustayEventDetail>();
  @Output() docustayEvent = new EventEmitter<{ type: DocustayEventType } & DocustayEventDetail>();
  @ViewChild("el", { static: true }) el!: ElementRef<HTMLElement>;
  private fns: Array<[DocustayEventType, EventListener]> = [];

  ngOnInit(): void {
    const types: DocustayEventType[] = ["ready", "waiting", "completed", "declined", "error", "resize"];
    for (const type of types) {
      const fn = ((e: CustomEvent<DocustayEventDetail>) => { (this[type] as EventEmitter<DocustayEventDetail>).emit(e.detail); this.docustayEvent.emit({ type, ...e.detail }); }) as EventListener;
      this.el.nativeElement.addEventListener(type, fn);
      this.fns.push([type, fn]);
    }
  }
  ngOnDestroy(): void { for (const [type, fn] of this.fns) this.el.nativeElement.removeEventListener(type, fn); this.fns = []; }
}
