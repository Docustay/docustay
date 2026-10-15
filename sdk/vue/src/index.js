import { defineComponent, h, ref, onMounted, onBeforeUnmount } from "vue";
import "@docustay2026/embed";

const TYPES = ["ready", "waiting", "completed", "declined", "error", "resize"];

/**
 * <DocustaySign :url="session.url" @completed="…" />
 * `url` comes from POST /api/v1/documents/{id}/embed-session, called from YOUR server.
 * Emits: ready, waiting, completed, declined, error, resize (each with { documentId, … }) and `event` (every event as { type, documentId, … }).
 */
export const DocustaySign = defineComponent({
  name: "DocustaySign",
  props: { url: { type: String, required: true }, height: { type: [Number, String], default: undefined }, autoHeight: { type: Boolean, default: false }, title: { type: String, default: undefined } },
  emits: [...TYPES, "event"],
  setup(props, { emit }) {
    const el = ref(null); const fns = [];
    onMounted(() => { for (const type of TYPES) { const fn = (e) => { emit(type, e.detail); emit("event", { type, ...e.detail }); }; el.value.addEventListener(type, fn); fns.push([type, fn]); } });
    onBeforeUnmount(() => { for (const [type, fn] of fns) el.value?.removeEventListener(type, fn); });
    return () => h("docustay-sign", { ref: el, url: props.url, ...(props.height != null ? { height: String(props.height) } : {}), ...(props.autoHeight ? { "auto-height": "" } : {}), ...(props.title ? { title: props.title } : {}) });
  },
});
export default DocustaySign;
