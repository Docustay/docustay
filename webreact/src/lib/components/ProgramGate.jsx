// ProgramGate — asks "which program?" before a picker lists catalogue items, using the practice's own
// Programs list. `onChoose({id, name})` fires with the person's pick. The "No program" choice is
// `{ id: null, name: "No program" }` — items with NO program are matched by `item.program_id ?? null === choice.id`,
// so they never vanish. A practice with no programs at all is never asked: it is reported as the
// "No program" choice immediately (every item is then unprogrammed, so everything shows).
//
// Usage: render this INSTEAD of a picker's usual list/combobox while `chosen` is null. Keep the WHOLE
// object in the caller's own state and filter with `(item.program_id ?? null) === chosen.id`
// (`matchesProgram(chosen, item.program_id)` below does exactly that). This component holds no
// catalogue data itself, it only asks the question and reports the answer.
import { useEffect, useState } from "react";
import { request } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button.jsx";

const NO_PROGRAM_CHOICE = Object.freeze({ id: null, name: "No program" });

/** True when an item whose program is `programId` (a uuid or null/undefined) belongs under `choice`. */
export function matchesProgram(choice, programId) {
  return (programId ?? null) === (choice?.id ?? null);
}

export default function ProgramGate({ onChoose, testId = "program-gate" }) {
  const [programs, setPrograms] = useState(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    request("/api/items/programs")
      .then((res) => {
        if (cancelled) return;
        const data = Array.isArray(res?.data) ? res.data : [];
        setPrograms(data);
        // A practice with no programs is never asked — every item is unprogrammed.
        if (data.length === 0) onChoose(NO_PROGRAM_CHOICE);
      })
      .catch(() => {
        if (!cancelled) {
          setPrograms([]);
          onChoose(NO_PROGRAM_CHOICE);
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!programs || programs.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 items-start py-2" data-testid={testId}>
      <p className="m-0 text-sm font-medium text-ink">Which program?</p>
      <div className="flex gap-2 flex-wrap">
        {programs.map((p) => (
          <Button
            key={p.id}
            type="button"
            variant="outline"
            onClick={() => onChoose(p)}
            data-testid={`${testId}-${p.id}`}
          >
            {p.name}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => onChoose(NO_PROGRAM_CHOICE)}
          data-testid={`${testId}-none`}
        >
          {NO_PROGRAM_CHOICE.name}
        </Button>
      </div>
    </div>
  );
}
