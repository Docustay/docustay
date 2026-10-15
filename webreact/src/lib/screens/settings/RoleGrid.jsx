// ═══════════════════════════════════════════════════════════════════════════════════════════════
// RoleGrid — the object/access/reach table (section 2) and 15 action switches (section 3)
// Child component of RoleEditor, can also be used in a sheet for member permissions (RP.6)
// Props: { role, view, canEdit, draftGrants, draftActions, setDraftGrants, setDraftActions }
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { VERBS, SCOPES, verbRank, scopeRank } from "@keystone/permissions/objects.mjs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/lib/components/ui/table.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";

// The 15 named actions from NAMED_ACTIONS in src/permissions/assertMay.mjs
// Mapped to their display labels per REACT-PLAN.md §6.1
const ACTION_LABELS = {
  "person.create": "Add people",
  "team.invite": "Invite to the team",
  "team.remove": "Remove from the team",
  "staff_role.change": "Change someone's role",
  "document.sign": "Sign documents",
  "document.execute": "Execute documents",
  "template.author": "Change templates",
  "record.archive": "Archive",
  "record.restore": "Restore",
  "booking.waive_charge": "Waive a booking charge",
  "discount.apply": "Apply a discount",
  "invoice.refund": "Refund",
  "setting.billing": "Change billing",
  "loyalty.manage": "Manage loyalty",
  "gift_card.manage": "Manage gift cards",
};

const ORDERED_ACTIONS = [
  "person.create",
  "team.invite",
  "team.remove",
  "staff_role.change",
  "document.sign",
  "document.execute",
  "template.author",
  "record.archive",
  "record.restore",
  "booking.waive_charge",
  "discount.apply",
  "invoice.refund",
  "setting.billing",
  "loyalty.manage",
  "gift_card.manage",
];

export default function RoleGrid({ role, view, canEdit, draftGrants, draftActions, setDraftGrants, setDraftActions }) {

  const vocabulary = view?.vocabulary ?? { objects: [], verbs: VERBS, scopes: SCOPES, ownerless: [] };
  const objectsArray = vocabulary.objects ?? [];
  const ownerlessSet = new Set(vocabulary.ownerless ?? []);

  // Check if practice has teams
  // TODO: This should come from the view/response
  const hasTeams = false;

  function readGrant(objectKey) {
    return draftGrants[objectKey] ?? { verb: "none", scope: "none" };
  }

  function setGrant(objectKey, verb, scope) {
    setDraftGrants({ ...draftGrants, [objectKey]: { verb, scope } });
  }

  function toggleActionSet(actions, on) {
    const next = new Set(draftActions);
    for (const a of actions) {
      if (on) {
        next.add(a);
      } else {
        next.delete(a);
      }
    }
    setDraftActions(next);
  }

  // Filter out 'goal' from the objects array
  const filteredObjects = objectsArray.filter((obj) => obj.key !== "goal");

  return (
    <>
      {/* Section 2: Object/Access/Reach table */}
      <section className="mb-4.5 rounded-card border border-line bg-surface px-4.25 py-3.5">
        <h2 className="m-0 mb-3 text-heading font-medium text-ink">Everything, one row per thing</h2>
        <div style={{ overflowX: "auto" }} data-testid="role-editor-grid">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader style={{ minWidth: "160px" }}>What</TableHeader>
                <TableHeader style={{ minWidth: "140px" }}>Can they</TableHeader>
                <TableHeader style={{ minWidth: "160px" }}>Whose</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredObjects.map((objectMeta) => {
                const objectKey = objectMeta.key;
                const currentGrant = readGrant(objectKey);
                const isOwnerless = objectMeta.ownable === false;

                // For ownerless objects, only "Everything's" is shown
                const legalScopes = isOwnerless ? ["everything"] : (objectMeta.scopes ?? SCOPES);

                return (
                  <TableRow key={objectKey} data-testid={`role-grid-row-${objectKey}`}>
                    <TableCell>{objectMeta?.label ?? objectKey}</TableCell>
                    <TableCell>
                      <Combobox
                        value={currentGrant.verb}
                        onValueChange={(v) =>
                          setGrant(objectKey, v, currentGrant.scope === "none" ? "everything" : currentGrant.scope)
                        }
                        options={[
                          { value: "none", label: "Nothing" },
                          { value: "view", label: "See" },
                          { value: "edit", label: "Change" },
                          { value: "delete", label: "Delete" },
                        ]}
                        disabled={!canEdit}
                        testId={`role-grid-access-${objectKey}`}
                      />
                    </TableCell>
                    <TableCell>
                      {isOwnerless ? (
                        <span data-testid={`role-grid-reach-${objectKey}`}>Everyone's</span>
                      ) : (
                        <Combobox
                          value={currentGrant.scope}
                          onValueChange={(s) =>
                            setGrant(objectKey, currentGrant.verb === "none" ? "view" : currentGrant.verb, s)
                          }
                          options={legalScopes.map((s) => ({
                            value: s,
                            label:
                              s === "owned"
                                ? "Their own"
                                : s === "team"
                                  ? hasTeams
                                    ? "Their team's"
                                    : "Their team's (disabled)"
                                  : "Everyone's",
                            disabled: s === "team" && !hasTeams,
                          }))}
                          disabled={!canEdit}
                          testId={`role-grid-reach-${objectKey}`}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {!hasTeams && (
          <p className="mt-2 mb-0 text-meta text-mute">
            No teams yet — this works once the practice has one.
          </p>
        )}
      </section>

      {/* Section 3: Action switches */}
      <section className="mb-4.5 rounded-card border border-line bg-surface px-4.25 py-3.5" data-testid="role-grid-actions">
        <h2 className="m-0 mb-3 text-heading font-medium text-ink">Also allowed to</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {ORDERED_ACTIONS.map((action) => (
            <div
              key={action}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 0",
              }}
            >
              <label style={{ flex: 1 }}>{ACTION_LABELS[action] || action}</label>
              <Switch
                data-testid={`role-action-${action}`}
                checked={draftActions.has(action)}
                disabled={!canEdit}
                onCheckedChange={(checked) => toggleActionSet([action], checked)}
              />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
