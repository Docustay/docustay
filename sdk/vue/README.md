# @docustay2026/vue

```vue
<DocustaySign :url="session.url" @completed="done" @error="failed" />
```

Props: `url`, `height`, `autoHeight`, `title`. Emits `ready`, `waiting`, `completed`, `declined`, `error`, `resize` and `event`. See `@docustay2026/embed` for setup.
