// BlockerBanner — "Two things need fixing before this can be saved." + the field labels.
// Ported from BlockerBanner.svelte: same props, testids and wording (number words up to ten).
import { Alert, AlertTitle, AlertDescription } from "@/lib/components/ui/alert.jsx";

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n) => (Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n][0].toUpperCase() + NUMBER_WORDS[n].slice(1) : String(n));

export default function BlockerBanner({ count, items = [], testId = "blocker-banner" }) {
  const headline = `${numberWord(count)} thing${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} fixing before this can be saved.`;
  return (
    <Alert className="rounded-card border-bad-border bg-bad-bg" data-testid={testId} data-count={count}>
      <AlertTitle className="text-ui font-medium text-bad" data-testid={`${testId}-headline`}>{headline}</AlertTitle>
      {items.length > 0 && (
        <AlertDescription data-testid={`${testId}-items`}>
          <ul className="m-0 pl-5 text-meta text-ink-2">{items.map((l) => <li key={l} data-testid={`${testId}-item`}>{l}</li>)}</ul>
        </AlertDescription>
      )}
    </Alert>
  );
}
