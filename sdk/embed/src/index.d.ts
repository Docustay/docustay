export type DocustayEventType = "ready" | "waiting" | "completed" | "declined" | "error" | "resize";
export interface DocustayEventDetail { documentId: string | null; height?: number; code?: string; [k: string]: unknown; }
export const EVENTS: readonly DocustayEventType[];
export class DocustaySign extends HTMLElement {
  url: string;
  addEventListener<K extends DocustayEventType>(type: K, listener: (ev: CustomEvent<DocustayEventDetail>) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: "docustay", listener: (ev: CustomEvent<{ type: DocustayEventType } & DocustayEventDetail>) => void, options?: boolean | AddEventListenerOptions): void;
}
export function defineDocustaySign(name?: string): void;
declare global { interface HTMLElementTagNameMap { "docustay-sign": DocustaySign; } }

export type BuilderEventType = "ready" | "saved" | "error" | "resize";
export interface BuilderEventDetail { templateId?: string; name?: string; fields?: number; message?: string; height?: number; [k: string]: unknown; }
export const BUILDER_EVENTS: readonly BuilderEventType[];
export class DocustayBuilder extends HTMLElement {
  url: string;
  addEventListener<K extends BuilderEventType>(type: K, listener: (ev: CustomEvent<BuilderEventDetail>) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: "docustay", listener: (ev: CustomEvent<{ type: BuilderEventType } & BuilderEventDetail>) => void, options?: boolean | AddEventListenerOptions): void;
}
export function defineDocustayBuilder(name?: string): void;
declare global { interface HTMLElementTagNameMap { "docustay-builder": DocustayBuilder; } }

export type ScribeEventType = "ready" | "drafted" | "send_requested" | "error" | "resize";
export interface ScribeEventDetail { documentId?: string; title?: string; message?: string; height?: number; [k: string]: unknown; }
export const SCRIBE_EVENTS: readonly ScribeEventType[];
export class DocustayScribe extends HTMLElement {
  url: string;
  addEventListener<K extends ScribeEventType>(type: K, listener: (ev: CustomEvent<ScribeEventDetail>) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: "docustay", listener: (ev: CustomEvent<{ type: ScribeEventType } & ScribeEventDetail>) => void, options?: boolean | AddEventListenerOptions): void;
}
export function defineDocustayScribe(name?: string): void;
declare global { interface HTMLElementTagNameMap { "docustay-scribe": DocustayScribe; } }
