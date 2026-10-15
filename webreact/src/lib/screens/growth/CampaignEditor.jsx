// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R7.021 — CampaignEditor.jsx — React port of webui/src/lib/screens/growth/CampaignEditor.svelte
// Props: { campaignId, onNavigate }
// Archetype: EditorPage
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from "react";
import { request, ApiError, api } from "@/lib/api.js";

import EditorPage from "@/lib/components/kit/archetypes/EditorPage.jsx";
import EditorSection from "@/lib/components/editor/EditorSection.jsx";
import EditorRail from "@/lib/components/editor/EditorRail.jsx";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import ErrorPanel from "@/lib/empty/ErrorPanel.jsx";
import DisabledWithReason from "@/lib/forms/DisabledWithReason.jsx";

import { Field, FieldLabel, FieldContent, FieldDescription } from "@/lib/components/ui/field.jsx";
import { Input } from "@/lib/components/ui/input.jsx";
import { Textarea } from "@/lib/components/ui/textarea.jsx";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Switch } from "@/lib/components/ui/switch.jsx";

import CampaignEditorSendToPeopleNowModal from "./CampaignEditorSendToPeopleNowModal.jsx";
import CampaignEditorModal2Modal from "./CampaignEditorModal2Modal.jsx";

const NEVER_MORE_THAN_OPTIONS = [
  { value: 30, label: "Once every 30 days" },
  { value: 60, label: "Once every 60 days" },
  { value: 90, label: "Once every 90 days" },
];

export default function CampaignEditor({ campaignId = null, onNavigate = null }) {
  // ── State ──────────────────────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [screenPhase, setScreenPhase] = useState("loading"); // loading, ready, error

  const [campaign, setCampaign] = useState(null);
  const [segments, setSegments] = useState([]);
  const [audienceData, setAudienceData] = useState(null);
  const [senderEmail, setSenderEmail] = useState("");
  const [templates, setTemplates] = useState([]);
  const [domainHealth, setDomainHealth] = useState(null);

  const [segmentId, setSegmentId] = useState("");
  const [leaveOutSegmentId, setLeaveOutSegmentId] = useState("");
  const [neverMoreThanDays, setNeverMoreThanDays] = useState(90);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [templateKey, setTemplateKey] = useState(null);
  const [sendNow, setSendNow] = useState(true);
  const [sendAt, setSendAt] = useState("");
  const [lastSendData, setLastSendData] = useState(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [showDiscardGuard, setShowDiscardGuard] = useState(false);

  // ── Read URL parameters for preselected segment ─────────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const preselectedSegmentId = params.get("segment");
      if (preselectedSegmentId) {
        setSegmentId(preselectedSegmentId);
      }
    }
  }, []);

  // ── Fetch campaign data and settings ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!campaignId || campaignId === "new") {
      initializeNewCampaign();
    } else {
      fetchCampaign(campaignId);
    }
  }, [campaignId]);

  // ── Fetch segments list ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    api.segments().then((r) => {
      if (!live) return;
      setSegments(
        (r?.rows ?? []).map((s) => ({ value: s.id, label: s.name }))
      );
    }).catch(() => { if (live) setSegments([]); });
    return () => { live = false; };
  }, []);

  // ── Fetch sender email from settings ────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    request("/api/settings/email").then((r) => {
      if (!live) return;
      setSenderEmail(r?.verified_from_email || "");
    }).catch(() => { if (live) setSenderEmail(""); });
    return () => { live = false; };
  }, []);

  // ── Fetch templates list ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    api.listTemplates("", "").then((r) => {
      if (!live) return;
      setTemplates(
        (r?.rows ?? []).map((t) => ({ value: t.key, label: t.name, family: t.family }))
      );
    }).catch(() => { if (live) setTemplates([]); });
    return () => { live = false; };
  }, []);

  // ── Fetch email domain health ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    api.getEmailDomainHealth().then((r) => {
      if (!live) return;
      setDomainHealth(r);
    }).catch(() => { if (live) setDomainHealth(null); });
    return () => { live = false; };
  }, []);

  // ── Update audience when segment changes ─────────────────────────────────────────────────
  useEffect(() => {
    if (segmentId) {
      updateAudience();
    }
  }, [segmentId, leaveOutSegmentId]);

  async function updateAudience() {
    try {
      setAudienceData(null);
      const data = await api.campaignAudience({
        segmentId,
        leaveOutSegmentId: leaveOutSegmentId || null,
      });
      setAudienceData(data);
    } catch (err) {
      // Silently fail on audience update, don't block the editor
      console.error("Failed to fetch audience data:", err);
    }
  }

  async function initializeNewCampaign() {
    try {
      setScreenPhase("ready");
      setLoading(false);
      setCampaign({
        id: "new",
        status: "draft",
        subject: "",
        message: "",
        segment_id: null,
        leave_out_segment_id: null,
        never_more_than_days: 90,
        send_at: null,
        created_at: new Date().toISOString(),
      });
      setSegmentId("");
      setLeaveOutSegmentId("");
      setNeverMoreThanDays(90);
      setSubject("");
      setMessage("");
      setTemplateKey(null);
      setSendNow(true);
      setSendAt("");
      setLastSendData(null);
      setDirty(false);
    } catch (err) {
      setError(err);
      setScreenPhase("error");
    }
  }

  async function fetchCampaign(cid) {
    try {
      setLoading(true);
      const res = await api.campaign(cid);
      const camp = res ?? null;

      if (!camp) {
        setScreenPhase("error");
        setError(new Error("Campaign not found"));
        return;
      }

      setCampaign(camp);

      setSegmentId(camp.segment_id || "");
      setLeaveOutSegmentId(camp.leave_out_segment_id || "");
      setNeverMoreThanDays(camp.never_more_than_days || 90);
      setSubject(camp.subject || "");
      setMessage(camp.message || "");
      setTemplateKey(camp.template_key || null);
      setSendAt(camp.send_at || "");
      setSendNow(!camp.send_at);
      setLastSendData(camp.last_send_data || null);

      setScreenPhase("ready");
      setDirty(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setScreenPhase("error");
      } else if (err instanceof ApiError && err.status === 404) {
        setScreenPhase("error");
        setError(new Error("Campaign not found"));
      } else {
        setScreenPhase("error");
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSegmentChange(value) {
    setSegmentId(value);
    setDirty(true);
  }

  function handleLeaveOutChange(value) {
    setLeaveOutSegmentId(value);
    setDirty(true);
  }

  function handleNeverMoreThanChange(e) {
    setNeverMoreThanDays(parseInt(e.target.value) || 90);
    setDirty(true);
  }

  function handleSubjectChange(e) {
    setSubject(e.target.value);
    setDirty(true);
  }

  function handleMessageChange(e) {
    setMessage(e.target.value);
    setDirty(true);
  }

  async function handleTemplateSelect(selectedTemplateKey) {
    try {
      const template = await api.getTemplate(selectedTemplateKey);
      if (template?.activeVersion) {
        const version = template.activeVersion;
        setSubject(version.subject || "");
        setMessage(version.textBody || version.htmlBody || "");
        setTemplateKey(selectedTemplateKey);
        setDirty(true);
      }
    } catch (err) {
      console.error("Failed to load template:", err);
    }
  }

  function handleSendNowChange(e) {
    setSendNow(e.target.checked);
    setDirty(true);
  }

  function handleSendAtChange(e) {
    setSendAt(e.target.value);
    setDirty(true);
  }

  async function handleSaveAsDraft() {
    if (saving || !campaign?.id) return;
    setSaving(true);
    setError(null);

    try {
      const payload = {
        subject: subject || null,
        message: message || null,
        segmentId: segmentId || null,
        leaveOutSegmentId: leaveOutSegmentId || null,
        neverMoreThanDays: neverMoreThanDays || 90,
        templateKey: templateKey || null,
      };

      if (campaign.id === "new") {
        await api.saveCampaign(payload);
      } else {
        await request(`/api/growth/campaigns/${campaign.id}`, {
          method: "PUT",
          body: payload,
        });
      }

      setDirty(false);
      if (campaign.id === "new") {
        await initializeNewCampaign();
      }
    } catch (err) {
      setError(err);
      console.error("Failed to save campaign:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    if (sending || !campaign?.id) return;
    setSending(true);
    setError(null);
    setShowDecisionModal(false);

    try {
      if (sendNow) {
        await api.sendCampaign({ campaignId: campaign.id });
      } else {
        await api.scheduleCampaign({ campaignId: campaign.id, sendAt });
      }
      setDirty(false);
      await fetchCampaign(campaign.id);
    } catch (err) {
      setError(err);
      console.error("Failed to send campaign:", err);
    } finally {
      setSending(false);
    }
  }

  async function handleSendTest() {
    if (sending || !campaign?.id) return;
    setSending(true);
    setError(null);

    try {
      await api.testCampaign({ campaignId: campaign.id });
    } catch (err) {
      setError(err);
      console.error("Failed to send test:", err);
    } finally {
      setSending(false);
    }
  }

  function openSendModal() {
    setShowDecisionModal(true);
  }

  function handleClose() {
    if (dirty && !showDiscardGuard) {
      setShowDiscardGuard(true);
      return;
    }
    onNavigate?.("/run/campaigns");
  }

  const audienceCount = useMemo(() => audienceData?.total_count ?? 0, [audienceData]);
  const excludedList = useMemo(() => audienceData?.excluded ?? [], [audienceData]);

  const verbs = useMemo(() => [
    { label: "Preview", kind: "plain", onClick: () => {}, disabled: true },
    { label: "Send a test to me", kind: "plain", onClick: handleSendTest, disabled: sending },
    { label: "Save as a draft", kind: "plain", onClick: handleSaveAsDraft, disabled: saving || sending },
    { label: sendNow ? "Send now" : "Schedule it", kind: "primary", onClick: openSendModal, disabled: audienceCount === 0 || sending || !segmentId },
  ], [sendNow, audienceCount, sending, saving]);

  // ── Handle phase-specific rendering ────────────────────────────────────────────────────────
  if (screenPhase === "loading") {
    return <ScreenState phase="loading" />;
  }

  if (screenPhase === "error") {
    return <ErrorPanel error={error} onBack={() => onNavigate?.("/run/campaigns")} />;
  }

  if (screenPhase !== "ready" || !campaign) {
    return null;
  }

  // ── Render ready state ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <EditorPage
        header={{
          title: campaign?.subject || "New Campaign",
          meta: campaign?.status === "draft" ? "Draft — nothing sent" : `Sent — ${campaign?.sent_count ?? 0} delivered`,
          verbs,
          onClose: handleClose,
          dirty,
          objectNoun: "campaign",
          testId: "campaign-editor-header",
        }}
        rail={
          <EditorRail objectNoun="campaign" testId="campaign-editor-rail">
            <div className="space-y-6">
              <div className="border-t border-hair pt-4">
                <h3 className="font-medium text-sm mb-1">Goes to</h3>
                <p className="text-sm text-ink-2 leading-relaxed">
                  {audienceCount > 0
                    ? `${audienceCount} ${audienceCount === 1 ? "person" : "people"}.`
                    : "Nobody on this list right now"}
                  {excludedList.length > 0 && excludedList.slice(0, 1).map((excluded) => (
                    <span key={excluded.id}> {excluded.name} is excluded — {excluded.reason}.</span>
                  ))}
                </p>
              </div>

              <div className="border-t border-hair pt-4">
                <h3 className="font-medium text-sm mb-1">From</h3>
                <p className="text-sm text-ok">
                  ✓ Verified<br />
                  {senderEmail || `hello@examplepractice.coach`}
                </p>
              </div>

              <div className="border-t border-hair pt-4">
                <h3 className="font-medium text-sm mb-1">Unsubscribing</h3>
                <p className="text-sm text-ink-2 leading-relaxed">
                  One click, on every one. Required, and right.
                </p>
              </div>

              {lastSendData && (
                <div className="border-t border-hair pt-4">
                  <h3 className="font-medium text-sm mb-1">Last time this ran</h3>
                  <p className="text-sm text-ink-2 leading-relaxed">
                    {lastSendData.count} sent in {lastSendData.month}, {lastSendData.opened} opened, {lastSendData.returned} came back.
                  </p>
                </div>
              )}

              <div className="border-t border-hair pt-4">
                <h3 className="font-medium text-sm mb-1">Never sends twice</h3>
                <p className="text-sm text-ink-2 leading-relaxed">
                  Once per person per {neverMoreThanDays} days.
                </p>
              </div>
            </div>
          </EditorRail>
        }
        testId="campaign-editor"
      >
        {error && (
          <div className="mb-4 p-3 bg-bad-soft border border-bad-soft rounded text-bad text-sm">
            {error.message || "An error occurred"}
          </div>
        )}

        <EditorSection title="Who it goes to">
          <Field>
            <FieldLabel htmlFor="campaign-segment" required>List</FieldLabel>
            <FieldContent>
              <Combobox
                id="campaign-segment"
                options={segments}
                value={segmentId}
                placeholder="Select a segment"
                onValueChange={handleSegmentChange}
              />
              {audienceCount > 0 && (
                <p className="mt-1.5 text-sm text-mute">
                  {audienceCount} {audienceCount === 1 ? "person" : "people"} on this list
                </p>
              )}
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="campaign-leave-out">
              Leave out <span className="text-xs text-mute">optional</span>
            </FieldLabel>
            <FieldContent>
              <Combobox
                id="campaign-leave-out"
                options={segments}
                value={leaveOutSegmentId}
                placeholder="Select who to exclude"
                onValueChange={handleLeaveOutChange}
              />
              <p className="mt-1.5 text-sm text-mute">
                Asking someone to come back while chasing them for $1,500 reads badly.
              </p>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="campaign-never-more-than">Never more than</FieldLabel>
            <FieldContent>
              <select
                id="campaign-never-more-than"
                value={neverMoreThanDays}
                onChange={handleNeverMoreThanChange}
                className="w-full min-h-10 px-3 py-2 border border-line rounded-control bg-white text-ink text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-0"
              >
                {NEVER_MORE_THAN_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="mt-1.5 text-sm text-mute">
                Nobody gets a win-back email twice in a quarter.
              </p>
            </FieldContent>
          </Field>
        </EditorSection>

        <EditorSection title="What it says">
          <Field>
            <FieldLabel htmlFor="campaign-template">Template</FieldLabel>
            <FieldContent>
              <Combobox
                id="campaign-template"
                options={templates}
                placeholder="Choose a template to fill subject and body"
                onValueChange={handleTemplateSelect}
              />
              <p className="mt-1.5 text-sm text-mute">
                Pick a template to auto-fill subject and body, then customize.
              </p>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="campaign-subject" required>Subject</FieldLabel>
            <FieldContent>
              <Input
                id="campaign-subject"
                value={subject}
                placeholder="It's been a while"
                onChange={handleSubjectChange}
              />
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel htmlFor="campaign-message" required>Message</FieldLabel>
            <FieldContent>
              <Textarea
                id="campaign-message"
                value={message}
                placeholder="Hi [first name] — noticed it's been a few weeks..."
                rows={4}
                onChange={handleMessageChange}
              />
            </FieldContent>
          </Field>
        </EditorSection>

        {domainHealth && (
          <EditorSection title="Domain health">
            {domainHealth.state === "ok" && (
              /* Verified domain shows no band */
              null
            )}
            {domainHealth.state === "unknown" && (
              <p className="p-3 bg-info-soft text-info rounded text-sm">
                Unable to determine email sending status. Check your domain verification.
              </p>
            )}
            {domainHealth.state === "broken" && (
              <div className="p-3 bg-warn-soft border-l-4 border-warn rounded">
                <p className="text-sm text-warn mb-2">
                  This send goes via the platform domain until DNS verifies — {domainHealth.address || 'your domain'}.
                </p>
                {domainHealth.record && (
                  <>
                    <p className="text-sm text-warn mb-2">
                      <strong>DNS record:</strong> {domainHealth.record.type} {domainHealth.record.name}
                    </p>
                    <code className="block p-2 bg-white border border-warn-soft rounded text-xs text-ink break-all">
                      {domainHealth.record.value}
                    </code>
                  </>
                )}
              </div>
            )}
          </EditorSection>
        )}

        <EditorSection title="Send checklist">
          <div className="p-3 bg-paper border border-line rounded space-y-2">
            <div className="flex justify-between items-center py-2">
              <span className="font-medium text-sm">Audience:</span>
              <span className="text-sm text-mute">{audienceCount || 0} people</span>
            </div>
            {audienceData?.excluded && (
              <div className="flex justify-between items-center py-2 border-t border-hair">
                <span className="font-medium text-sm">Excluded:</span>
                <span className="text-sm text-mute">
                  {(() => {
                    const unsubscribed = audienceData.excluded.filter(x => x.reason === "unsubscribed").length;
                    const bounced = audienceData.excluded.filter(x => x.reason === "bounced").length;
                    const outsideConsent = audienceData.excluded.filter(x => x.reason === "outside_consent").length;
                    return `${audienceData.excluded.length} people: ${unsubscribed} unsubscribed, ${bounced} bounced, ${outsideConsent} outside consent`;
                  })()}
                </span>
              </div>
            )}
            {neverMoreThanDays > 0 && (
              <div className="flex justify-between items-center py-2 border-t border-hair">
                <span className="font-medium text-sm">Quiet hours:</span>
                <span className="text-sm text-mute">Enabled — respects practice settings</span>
              </div>
            )}
          </div>
        </EditorSection>

        <EditorSection title="When">
          <Field>
            <FieldLabel required>Send</FieldLabel>
            <FieldContent>
              <div className="space-y-3 mb-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="send-timing"
                    value="now"
                    checked={sendNow}
                    onChange={() => { setSendNow(true); setDirty(true); }}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Send now</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="send-timing"
                    value="later"
                    checked={!sendNow}
                    onChange={() => { setSendNow(false); setDirty(true); }}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Schedule for</span>
                </label>
              </div>

              {!sendNow && (
                <Input
                  type="datetime-local"
                  value={sendAt}
                  onChange={handleSendAtChange}
                  required
                  className="mb-4"
                />
              )}

              <p className="text-sm text-mute">
                Mid-morning midweek gets read. Monday and Friday don't.
              </p>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>Follow up</FieldLabel>
            <FieldContent>
              <DisabledWithReason disabled={true} reason="Needs open tracking, which we don't collect">
                <Switch disabled aria-describedby="campaign-followup-reason" />
              </DisabledWithReason>
            </FieldContent>
          </Field>
        </EditorSection>
      </EditorPage>

      <CampaignEditorSendToPeopleNowModal
        open={showDecisionModal}
        onOpenChange={setShowDecisionModal}
        showDecisionModal={showDecisionModal}
        handleSend={handleSend}
        audienceCount={audienceCount}
      />

      <CampaignEditorModal2Modal
        open={showDiscardGuard}
        onOpenChange={setShowDiscardGuard}
        onNavigate={onNavigate}
        showDiscardGuard={showDiscardGuard}
      />
    </>
  );
}
