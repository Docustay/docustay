# @docustay2026/react

```jsx
import { DocustaySign } from "@docustay2026/react";
<DocustaySign url={session.url} onCompleted={({ documentId }) => …} onError={…} />
```

Props: `url` (from `POST /api/v1/documents/{id}/embed-session`, called from your server), `height`, `autoHeight`, `title`, `className`, `style`; callbacks `onReady`, `onWaiting`, `onCompleted`, `onDeclined`, `onError`, `onResize`, `onEvent`. See `@docustay2026/embed` for setup.
