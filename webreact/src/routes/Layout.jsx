// The root layout (R3.021, webui routes/+layout.svelte): its only job is the stylesheet — imported by EVERY entry, so
// no page can ship unstyled (the Svelte app once served 63 correct lines of CSS that nothing imported). It draws no
// chrome: the shell is the app's own, and the auth pages are full-page surfaces of their own.
import "../styles/theme.css";

export default function Layout({ children }) {
  return children;
}
