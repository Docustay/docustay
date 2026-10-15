// The ⌘K palette's one piece of shared state: whether it is open (the sidebar's Search button, the phone's top bar and the keyboard shortcut all flip the same value).
class Palette { open = $state(false); }
export const palette = new Palette();
