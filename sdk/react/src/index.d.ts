import type { CSSProperties, ReactElement } from "react";
import type { DocustayEventDetail, DocustayEventType } from "@docustay2026/embed";
export interface DocustaySignProps {
  url: string; height?: number | string; autoHeight?: boolean; title?: string; className?: string; style?: CSSProperties;
  onReady?(d: DocustayEventDetail): void; onWaiting?(d: DocustayEventDetail): void; onCompleted?(d: DocustayEventDetail): void; onDeclined?(d: DocustayEventDetail): void; onError?(d: DocustayEventDetail): void; onResize?(d: DocustayEventDetail): void;
  onEvent?(e: { type: DocustayEventType } & DocustayEventDetail): void;
}
export function DocustaySign(props: DocustaySignProps): ReactElement;
