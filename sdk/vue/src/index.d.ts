import type { DefineComponent } from "vue";
import type { DocustayEventDetail, DocustayEventType } from "@docustay2026/embed";
export const DocustaySign: DefineComponent<{ url: string; height?: number | string; autoHeight?: boolean; title?: string }, {}, {}, {}, {}, {}, {}, {
  ready: (d: DocustayEventDetail) => void; waiting: (d: DocustayEventDetail) => void; completed: (d: DocustayEventDetail) => void; declined: (d: DocustayEventDetail) => void; error: (d: DocustayEventDetail) => void; resize: (d: DocustayEventDetail) => void;
  event: (e: { type: DocustayEventType } & DocustayEventDetail) => void;
}>;
export default DocustaySign;
