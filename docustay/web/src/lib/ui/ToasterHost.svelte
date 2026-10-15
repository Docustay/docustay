<script>
  // The toast stack, mounted by the app shell only when it is first needed or the browser is idle (svelte-sonner's drawing code is not in the shell's first download).
  import { Toaster } from "svelte-sonner";
  import { theme } from "$lib/theme/theme.svelte.js";
</script>
<Toaster position="bottom-center" richColors closeButton visibleToasts={3} expand={false} theme={theme.resolved} toastOptions={{ class: "ds-toast" }} />
