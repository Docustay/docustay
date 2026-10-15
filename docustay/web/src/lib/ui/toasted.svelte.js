// How many toasts have been asked for: the app shell mounts the toast stack (ToasterHost) the first time this is above zero.
export const toasted = $state({ n: 0 });
