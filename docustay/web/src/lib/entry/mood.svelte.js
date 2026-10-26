// What the entry scene is doing right now: "idle" (a slow float), "working" (the sheets gather: a code is being sent, checked, a workspace made), "done" (the stack settles and the seal shows), "error" (one short red pulse).
// The pages set it; the layout passes it to <Stage>. A page that unmounts puts it back to idle.
export const entry = $state({ mood: "idle" });
