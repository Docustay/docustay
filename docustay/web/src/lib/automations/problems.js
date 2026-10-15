// What the server says is wrong with an automation's flow (src/documents/playbookFlow.mjs, playbooks.mjs), in the reader's language: each problem carries a `code` and its `vars`;
// its English `text` is used only for a code this screen does not know.
import { t } from "$lib/i18n/index.svelte.js";

export function problemText(p) {
  const v = p?.vars ?? {};
  switch (p?.code) {
    case "shape": return t("This automation could not be read. Start it again.");
    case "when_kind": return t("Choose what starts it: a document from a template or form is signed.");
    case "when_template": return t("Choose the template or form whose signed documents start it.");
    case "when_missing": return t("The starting template or form is not one of yours.");
    case "too_many": return t("An automation has at most 12 steps.");
    case "no_send": return t("Add a “Then send” step: an automation that sends nothing does nothing.");
    case "unknown_step": return t("This step is not one an automation can take.");
    case "rule_bad": return t("This condition is not one an automation can check.");
    case "rule_box": return t("The condition reads “{box}”, which is not a box on the starting template.", { box: v.box ?? "" });
    case "send_template": return t("Choose the template to send.");
    case "send_missing": return t("The template to send is not one of yours, or it was retired.");
    case "one_signer": return t("An automation sends a template one person signs (it has a signature box for exactly one person).");
    case "fill_many": return t("At most 40 boxes can be filled from answers.");
    case "fill_bad": return t("A filled box names a box that does not exist.");
    case "fill_source": return t("“{box}” is not a box on the starting template.", { box: v.box ?? "" });
    case "fill_target": return t("“{box}” is not a box on the template it sends.", { box: v.box ?? "" });
    case "fill_signing": return t("“{box}” is filled in by signing, so it cannot be filled from an answer.", { box: v.box ?? "" });
    case "wait_first": return t("A wait comes after a “Then send” step: it waits for what was sent.");
    case "wait_days": return t("Wait between 1 and 60 whole days.");
    case "remind_first": return t("A reminder comes after a “Then send” step.");
    default: return p?.text ?? "";
  }
}
