# @docustay2026/angular

Standalone component (Angular 17+):

```ts
import { DocustaySignComponent } from "@docustay2026/angular";
// imports: [DocustaySignComponent]
// <docustay-sign-form [url]="session.url" (completed)="done($event)" (error)="failed($event)"></docustay-sign-form>
```

Inputs: `url`, `height`, `autoHeight`, `title`. Outputs: `ready`, `waiting`, `completed`, `declined`, `error`, `resize`, `docustayEvent`. See `@docustay2026/embed` for setup.
