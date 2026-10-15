import { useState, useEffect, useCallback } from "react";
import { request, api, ApiError } from "@/lib/api.js";
import { listAgreementTemplates } from "@/lib/documents/index.js";
import PersonFormPersonSheet from "./PersonFormPersonSheet.jsx";

export default function PersonForm({ person = null, onDone = null, onCancel = null }) {
  const editing = Boolean(person);

  // Basic fields
  const [displayName, setDisplayName] = useState(person?.display_name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");
  const [mobilePhone, setMobilePhone] = useState(person?.mobile_phone ?? "");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // ★ the maintainer, 29 Sep 2026 — "parent is a tag, not a role": CREATE-ONLY choices. `role` replaces the old
  //   hard-coded "adult_client"; `isLead` replaces the old silent "omit it and the column defaults
  //   to 'lead'" behaviour with an explicit choice; `childUserIds`/`parentUserId` are the two halves
  //   of "link any children (which gives them the Parent tag) — adolescents still need a parent
  //   linked", each real via `keystone.guardian` (`api.linkGuardian`), not a second concept.
  const [role, setRole] = useState("adult_client");
  const [isLead, setIsLead] = useState(false);
  const [childUserIds, setChildUserIds] = useState([]);
  const [parentUserId, setParentUserId] = useState("");
  // ★ the maintainer, 29 Sep 2026 — "A 'Send portal invite' tick box on the create form." Defaults OFF: an
  //   email is a deliberate choice a coach makes, never a side effect of adding someone (same
  //   "sent explicitly, including when false" idiom `api.createPerson`'s own `invite` flag already
  //   documents for itself).
  const [sendPortalInvite, setSendPortalInvite] = useState(false);
  const [adolescentOptions, setAdolescentOptions] = useState([]);
  const [adultOptions, setAdultOptions] = useState([]);
  // Programs the person is in — SET on save via api.setPersonPrograms (edit loads the current set first).
  const [programIds, setProgramIds] = useState([]);
  const [initialProgramIds, setInitialProgramIds] = useState([]);
  useEffect(() => {
    if (!person?.id) return undefined;
    let live = true;
    api.getPersonPrograms(person.id)
      .then((r) => { if (!live) return; const ids = (r?.data ?? []).map((p) => p.id); setProgramIds(ids); setInitialProgramIds(ids); })
      .catch(() => {});
    return () => { live = false; };
  }, [person?.id]);
  const programsChanged = programIds.length !== initialProgramIds.length || programIds.some((id) => !initialProgramIds.includes(id));

  // Referred by - the PERSON edge
  const [referredById, setReferredById] = useState(person?.referred_by_id ?? "");
  const initialReferredById = person?.referred_by_id ?? "";

  // CREATE-ONLY STATE — Money / Getting started
  const [whoPaysGroupId, setWhoPaysGroupId] = useState("");
  const [payerGroups, setPayerGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [showNewAccountSheet, setShowNewAccountSheet] = useState(false);

  const [sendTemplateId, setSendTemplateId] = useState("");
  const [contractTemplates, setContractTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);

  const [howHeardValue, setHowHeardValue] = useState("");
  const [networkParties, setNetworkParties] = useState([]);

  // Required fields from the setting
  const [requiredFields, setRequiredFields] = useState([]);

  // DOB helper's teen-agreement sentence
  const [hasAdolescents, setHasAdolescents] = useState(false);

  // Duplicate-check state — CREATE only
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [possibleDuplicate, setPossibleDuplicate] = useState(null);
  const [proceedWithCreate, setProceedWithCreate] = useState(false);

  // People options for "Referred by"
  const [peopleOptions, setPeopleOptions] = useState([]);

  // Fetch required fields
  useEffect(() => {
    request("/api/settings/fields-required")
      .then((data) => {
        const rules = data?.rules?.person;
        if (rules) setRequiredFields(rules.required || []);
      })
      .catch(() => setRequiredFields([]));
  }, []);

  // Fetch adolescents — also the "link children" options for a new Adult (Parent tag).
  useEffect(() => {
    if (editing) return;
    let live = true;
    request("/api/list/people/adolescents")
      .then((r) => {
        if (!live) return;
        const rows = r?.rows ?? [];
        setHasAdolescents(rows.length > 0);
        setAdolescentOptions(rows.map((p) => ({ id: p.id, name: p.display_name ?? p.email ?? p.id })));
      })
      .catch(() => {
        if (live) { setHasAdolescents(false); setAdolescentOptions([]); }
      });
    return () => {
      live = false;
    };
  }, [editing]);

  // Fetch adults — the "Parent" picker a new Adolescent must link (0533's guardian requirement).
  useEffect(() => {
    if (editing || role !== "adolescent_client") return;
    let live = true;
    request("/api/list/people/clients")
      .then((r) => {
        if (!live) return;
        setAdultOptions((r?.rows ?? []).map((p) => ({ value: p.id, label: p.display_name ?? p.email ?? p.id })));
      })
      .catch(() => {
        if (live) setAdultOptions([]);
      });
    return () => {
      live = false;
    };
  }, [editing, role]);

  // Fetch payer groups
  useEffect(() => {
    if (editing) {
      setGroupsLoading(false);
      return;
    }
    let live = true;
    setGroupsLoading(true);
    api
      .payerGroups()
      .then((r) => {
        if (!live) return;
        setPayerGroups(r?.groups ?? []);
      })
      .catch(() => {
        if (live) setPayerGroups([]);
      })
      .finally(() => {
        if (live) setGroupsLoading(false);
      });
    return () => {
      live = false;
    };
  }, [editing]);

  // Handle "New family account…" option
  useEffect(() => {
    if (whoPaysGroupId === "__new__") setShowNewAccountSheet(true);
  }, [whoPaysGroupId]);

  const refreshPayerGroups = useCallback(() => {
    return api
      .payerGroups()
      .then((r) => setPayerGroups(r?.groups ?? []))
      .catch(() => {});
  }, []);

  const onNewAccountDone = useCallback((id) => {
    setShowNewAccountSheet(false);
    refreshPayerGroups().then(() => setWhoPaysGroupId(id));
  }, [refreshPayerGroups]);

  const onNewAccountCancel = useCallback(() => {
    setShowNewAccountSheet(false);
    setWhoPaysGroupId("");
  }, []);

  // DOB requirements
  const dobRequired = requiredFields.includes("date_of_birth");
  const dobHelper =
    !dobRequired
      ? "optional"
      : hasAdolescents
        ? "Required, because you take teenage clients — Under 18 gets the teen agreement and a parent on the account."
        : "Required";

  // Pre-computed createInvalid and createInvalidReason for use in multiple places
  const needsParent = role === "adolescent_client" && !parentUserId;
  const createInvalid = !displayName.trim() || !email.trim() || (dobRequired && !dateOfBirth) || needsParent;
  const createInvalidReason =
    !displayName.trim()
      ? "Add a name first."
      : !email.trim()
        ? "Add an email first."
        : dobRequired && !dateOfBirth
          ? "Add a date of birth first."
          : needsParent
            ? "Link a parent first."
            : "";

  // ★ The two guardian links this form can create post-save. `role`/`isLead` reach `api.createPerson`
  //   directly (below); these two run AFTER the person exists, same order `whoPaysGroupId`'s
  //   follow-up write already uses.
  const linkGuardians = useCallback(async (createdId) => {
    if (role === "adult_client") {
      for (const childId of childUserIds) {
        await api.linkGuardian({ childUserId: childId, guardianUserId: createdId });
      }
    } else if (role === "adolescent_client" && parentUserId) {
      await api.linkGuardian({ childUserId: createdId, guardianUserId: parentUserId });
    }
  }, [role, childUserIds, parentUserId]);

  // Derived values for the two referral edges
  const howHeardIsParty =
    Boolean(howHeardValue) && howHeardValue !== "word_of_mouth" && howHeardValue !== "found_online";
  const referredByFilled = Boolean(referredById);
  const REFERRER_REASON = "A person was sent by a person or by a party, not both.";

  // Handler for "add anyway" button - bypass duplicate check and proceed with create
  const onDuplicateProceed = useCallback(async () => {
    setShowDuplicateWarning(false);
    if (busy) return;
    if (createInvalid) return;

    setBusy(true);
    setError(null);

    try {
      const sourceValue =
        howHeardValue === "word_of_mouth"
          ? "Word of mouth"
          : howHeardValue === "found_online"
            ? "Found you online"
            : undefined;

      const created = await api.createPerson({
        email: email.trim(),
        displayName: displayName.trim(),
        role,
        lifecycleStatus: isLead ? "lead" : "active",
        invite: true,
        mobilePhone: mobilePhone.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
        source: sourceValue,
        referredById: referredById || undefined,
        referredByPartyId: howHeardIsParty ? howHeardValue : undefined,
      });

      // Follow-up writes
      if (whoPaysGroupId && whoPaysGroupId !== "__new__") {
        await api.addPayerGroupMember(whoPaysGroupId, { person_id: created.id });
      }
      await linkGuardians(created.id);
      if (programIds.length) await api.setPersonPrograms({ personId: created.id, programIds });
      // ★ the maintainer, 29 Sep 2026 — the create form's "Send portal invite" tick box. Same call the record
      //   page's "Send portal invite" button makes (`resendInvitePerson` — F632's route does not
      //   distinguish first send from resend); for an adolescent this is where the server redirects
      //   to their just-linked parent.
      if (sendPortalInvite) await api.resendInvitePerson({ personId: created.id });
      if (sendTemplateId) {
        const tpl = contractTemplates.find((t) => t.id === sendTemplateId);
        const doc = await api.createDocument({
          builder: "contract",
          title: tpl?.name ?? "Agreement",
          templateId: sendTemplateId,
          subjectUserId: created.id,
        });
        await api.sendDocument({ instanceId: doc.id });
      }

      onDone?.(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
      setBusy(false);
    }
  }, [
    busy,
    createInvalid,
    howHeardValue,
    displayName,
    email,
    mobilePhone,
    dateOfBirth,
    referredById,
    howHeardIsParty,
    whoPaysGroupId,
    sendTemplateId,
    contractTemplates,
    role,
    isLead,
    linkGuardians,
    sendPortalInvite,
    programIds,
    onDone,
  ]);

  // Fetch contract templates
  useEffect(() => {
    if (editing) {
      setTemplatesLoading(false);
      return;
    }
    let live = true;
    setTemplatesLoading(true);
    listAgreementTemplates()
      .then((r) => {
        if (!live) return;
        setContractTemplates((r?.rows ?? []).filter((t) => t.active));
      })
      .catch(() => {
        if (live) setContractTemplates([]);
      })
      .finally(() => {
        if (live) setTemplatesLoading(false);
      });
    return () => {
      live = false;
    };
  }, [editing]);

  // Fetch network parties
  useEffect(() => {
    if (editing) return;
    let live = true;
    request("/api/list/network")
      .then((r) => {
        if (!live) return;
        setNetworkParties((r?.rows ?? []).map((p) => ({ id: p.id, name: p.name })));
      })
      .catch(() => {
        if (live) setNetworkParties([]);
      });
    return () => {
      live = false;
    };
  }, [editing]);

  // Fetch people options
  useEffect(() => {
    let live = true;
    request("/api/list/people/all")
      .then((r) => {
        if (!live) return;
        setPeopleOptions(
          (r?.rows ?? [])
            .filter((p) => !editing || p.id !== person.id)
            .map((p) => ({ value: p.id, label: p.display_name ?? p.email ?? p.id }))
        );
      })
      .catch(() => {
        if (live) setPeopleOptions([]);
      });
    return () => {
      live = false;
    };
  }, [editing, person?.id]);

  // Submit handler
  const submit = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (busy) return;

      if (editing) {
        // EDIT PATH
        const patch = { personId: person.id };
        if (displayName.trim() !== (person.display_name ?? "")) patch.displayName = displayName.trim();
        if (email.trim() !== (person.email ?? "")) patch.email = email.trim();
        if (referredById !== initialReferredById)
          patch.referredById = referredById === "" ? null : referredById;

        if (Object.keys(patch).length === 1 && !programsChanged) {
          onCancel?.();
          return;
        }

        setBusy(true);
        setError(null);
        try {
          if (Object.keys(patch).length > 1) await api.updatePerson(patch);
          if (programsChanged) await api.setPersonPrograms({ personId: person.id, programIds });
          onDone?.();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
        } finally {
          setBusy(false);
        }
        return;
      }

      // CREATE PATH
      if (createInvalid) return;

      setBusy(true);
      setError(null);

      try {
        if (!proceedWithCreate) {
          const { possible } = await api.checkDuplicatePerson({
            displayName: displayName.trim(),
            email: email.trim() || null,
            mobilePhone: mobilePhone.trim() || null,
          });
          if (possible) {
            setPossibleDuplicate(possible);
            setShowDuplicateWarning(true);
            setBusy(false);
            return;
          }
        }

        setProceedWithCreate(false);

        const sourceValue =
          howHeardValue === "word_of_mouth"
            ? "Word of mouth"
            : howHeardValue === "found_online"
              ? "Found you online"
              : undefined;

        const created = await api.createPerson({
          email: email.trim(),
          displayName: displayName.trim(),
          role,
          lifecycleStatus: isLead ? "lead" : "active",
          invite: true,
          mobilePhone: mobilePhone.trim() || undefined,
          dateOfBirth: dateOfBirth || undefined,
          source: sourceValue,
          referredById: referredById || undefined,
          referredByPartyId: howHeardIsParty ? howHeardValue : undefined,
        });

        // Follow-up writes
        if (whoPaysGroupId && whoPaysGroupId !== "__new__") {
          await api.addPayerGroupMember(whoPaysGroupId, { person_id: created.id });
        }
        await linkGuardians(created.id);
        if (programIds.length) await api.setPersonPrograms({ personId: created.id, programIds });
      // ★ the maintainer, 29 Sep 2026 — the create form's "Send portal invite" tick box. Same call the record
      //   page's "Send portal invite" button makes (`resendInvitePerson` — F632's route does not
      //   distinguish first send from resend); for an adolescent this is where the server redirects
      //   to their just-linked parent.
      if (sendPortalInvite) await api.resendInvitePerson({ personId: created.id });
        if (sendTemplateId) {
          const tpl = contractTemplates.find((t) => t.id === sendTemplateId);
          const doc = await api.createDocument({
            builder: "contract",
            title: tpl?.name ?? "Agreement",
            templateId: sendTemplateId,
            subjectUserId: created.id,
          });
          await api.sendDocument({ instanceId: doc.id });
        }

        onDone?.(created.id);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err?.message ?? err));
        setBusy(false);
      }
    },
    [
      editing,
      person,
      busy,
      displayName,
      email,
      referredById,
      initialReferredById,
      createInvalid,
      proceedWithCreate,
      mobilePhone,
      dateOfBirth,
      howHeardValue,
      howHeardIsParty,
      whoPaysGroupId,
      sendTemplateId,
      contractTemplates,
      role,
      isLead,
      linkGuardians,
      sendPortalInvite,
      programIds,
      programsChanged,
      onDone,
      onCancel,
    ]
  );

  return (
    <PersonFormPersonSheet
      open={true}
      person={person}
      onDone={onDone}
      onCancel={onCancel}
      editing={editing}
      displayName={displayName}
      email={email}
      mobilePhone={mobilePhone}
      dateOfBirth={dateOfBirth}
      busy={busy}
      error={error}
      referredById={referredById}
      whoPaysGroupId={whoPaysGroupId}
      payerGroups={payerGroups}
      groupsLoading={groupsLoading}
      showNewAccountSheet={showNewAccountSheet}
      sendTemplateId={sendTemplateId}
      contractTemplates={contractTemplates}
      templatesLoading={templatesLoading}
      howHeardValue={howHeardValue}
      networkParties={networkParties}
      onNewAccountDone={onNewAccountDone}
      onNewAccountCancel={onNewAccountCancel}
      peopleOptions={peopleOptions}
      howHeardIsParty={howHeardIsParty}
      referredByFilled={referredByFilled}
      REFERRER_REASON={REFERRER_REASON}
      showDuplicateWarning={showDuplicateWarning}
      possibleDuplicate={possibleDuplicate}
      proceedWithCreate={proceedWithCreate}
      dobRequired={dobRequired}
      dobHelper={dobHelper}
      submit={submit}
      onDuplicateProceed={onDuplicateProceed}
      onDisplayNameChange={setDisplayName}
      onEmailChange={setEmail}
      onMobilePhoneChange={setMobilePhone}
      onDateOfBirthChange={setDateOfBirth}
      onReferredByIdChange={setReferredById}
      onWhoPaysGroupIdChange={setWhoPaysGroupId}
      onSendTemplateIdChange={setSendTemplateId}
      onHowHeardValueChange={setHowHeardValue}
      role={role}
      onRoleChange={setRole}
      isLead={isLead}
      onIsLeadChange={setIsLead}
      childUserIds={childUserIds}
      onChildUserIdsChange={setChildUserIds}
      parentUserId={parentUserId}
      onParentUserIdChange={setParentUserId}
      adolescentOptions={adolescentOptions}
      adultOptions={adultOptions}
      sendPortalInvite={sendPortalInvite}
      onSendPortalInviteChange={setSendPortalInvite}
      programIds={programIds}
      onProgramIdsChange={setProgramIds}
    />
  );
}
