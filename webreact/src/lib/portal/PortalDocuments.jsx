// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R9.008 — PortalDocuments: port faithfully
//
// ★★★ DOCUMENTS LIST, CATEGORIZED BY STATE
// Shows documents waiting to sign, signed documents, and session notes.
// Clicking "Read and sign" opens DocumentSigning modal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useEffect, useState, useMemo } from "react";
import { request } from "@/lib/api.js";
import ScreenState from "@/lib/empty/ScreenState.jsx";
import { Badge } from "@/lib/components/ui/badge.jsx";
import DocumentSigning from "./DocumentSigning.jsx";
import PhoneCard from "@/lib/phone/PhoneCard.jsx";
import { PhoneSectionLabel } from "@/lib/phone/PhoneRow.jsx";
import { Check, NotebookText } from "lucide-react";

export default function PortalDocuments({ data = null, role = null, onNavigate = null }) {
  const [documents, setDocuments] = useState([]);
  const [signingDocumentId, setSigningDocumentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ★★ FETCH DOCUMENTS ON MOUNT
  useEffect(() => {
    const fetchDocuments = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await request("/api/app/documents");
        setDocuments(Array.isArray(data.documents) ? data.documents : []);
      } catch (e) {
        setError(e.message || "Failed to load documents");
      } finally {
        setLoading(false);
      }
    };

    fetchDocuments();
  }, []);

  // ★★ CATEGORIZE DOCUMENTS
  const waitingToSign = useMemo(
    () => documents.filter((d) => d.state === "sent" || d.state === "partially_signed"),
    [documents]
  );

  const signed = useMemo(
    () => documents.filter((d) => d.executed_at !== null),
    [documents]
  );

  const fromSessions = useMemo(
    () => documents.filter((d) => d.is_session_note && !signed.some((s) => s.id === d.id)),
    [documents]
  );

  // ★★ FORMAT DATE
  function formatDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const day = d.getDate();
    const month = d.toLocaleDateString("en-US", { month: "long" });
    return `${day} ${month}`;
  }

  // ★★ FORMAT FULL DATETIME
  function formatFullDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // ★★ HANDLE SIGN BUTTON
  function handleSign(docId) {
    setSigningDocumentId(docId);
  }

  // ★★ CLOSE SIGNING VIEW
  function closeSigning() {
    setSigningDocumentId(null);
    // Refresh documents after signing
    setLoading(true);
    request("/api/app/documents")
      .then((data) => {
        setDocuments(Array.isArray(data.documents) ? data.documents : []);
      })
      .catch((e) => {
        setError(e.message || "Failed to load documents");
      })
      .finally(() => {
        setLoading(false);
      });
  }

  // ★★ NAVIGATE TO MESSAGES
  function askHost() {
    if (onNavigate) {
      onNavigate("/app/messages");
    }
  }

  // ★★ SHOW SIGNING SCREEN WHEN A DOCUMENT IS SELECTED
  if (signingDocumentId) {
    return (
      <DocumentSigning
        documentId={signingDocumentId}
        onClose={closeSigning}
        onAskHost={askHost}
      />
    );
  }

  // ★★ ERROR STATE
  if (error) {
    return <ScreenState phase="error" error={error} subject="your documents" />;
  }

  // ★★ LOADING STATE
  if (loading) {
    return <ScreenState phase="loading" />;
  }

  // ★★ EMPTY STATE
  if (documents.length === 0) {
    return (
      <div className="py-10 px-5 text-center">
        <div className="font-medium text-[17px] text-[var(--ink)] mb-[7px]">
          No documents yet
        </div>
        <div className="text-sm text-[var(--ink-muted)] leading-[1.6] max-w-[46ch] mx-auto">
          Anything your practice sends you shows up here.
        </div>
      </div>
    );
  }

  // ★★ DOCUMENTS LIST — ★ the maintainer, 29 Sep 2026 (portal critique #3): the screen's own outer gutter
  //   is gone, PhoneShell already provides it for every phone screen.
  return (
    <div>
      {/* ★★ WAITING ON YOU CARD */}
      {waitingToSign.length > 0 && (
        <div className="mb-0">
          {waitingToSign.map((doc) => (
            <PhoneCard key={doc.id} variant="warm" label={doc.title}>
              <div className="text-sm text-[var(--ink-muted)] mt-[5px] leading-[1.55]">
                {doc.updated_at && (
                  <>
                    Updated {formatFullDate(doc.updated_at)}.{" "}
                  </>
                )}
                Read and sign it when you get a minute.
              </div>
              <div className="flex gap-2 mt-[13px]">
                <button
                  className="flex-1 h-8 px-[13px] text-sm font-medium rounded-[7px] border border-[var(--line)] bg-[var(--color-brand)] text-white cursor-pointer hover:opacity-90"
                  onClick={() => handleSign(doc.id)}
                  data-testid="document-sign-btn"
                >
                  Read and sign
                </button>
              </div>
            </PhoneCard>
          ))}
        </div>
      )}

      {/* ★★ SIGNED SECTION */}
      {signed.length > 0 && (
        <div className="mt-[18px]">
          <PhoneSectionLabel>Signed</PhoneSectionLabel>
          {signed.map((doc) => (
            <div key={doc.id} className="flex items-start gap-3 py-[13px] border-b border-[var(--color-structure-150)]" data-testid="document-row" data-id={doc.id}>
              <div className="w-[54px] flex-shrink-0 flex items-start justify-center pt-0.5" style={{ color: "var(--color-success-600, var(--ok))" }}>
                <Check size={16} strokeWidth={2.25} aria-hidden="true" />
              </div>
              <div className="flex-1 text-sm leading-[1.45]">
                <div className="text-[var(--ink)] font-medium mb-[3px]">
                  {doc.title}
                </div>
                <div className="text-xs text-[var(--ink-muted)] mt-[3px]">
                  Signed {formatDate(doc.executed_at)}
                  {doc.builder && (
                    <>
                      {" "}· you and {doc.builder}
                    </>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0">
                <Badge variant="secondary">Done</Badge>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ★★ FROM YOUR SESSIONS SECTION */}
      {fromSessions.length > 0 && (
        <div className="mt-[18px]">
          <PhoneSectionLabel>From your sessions</PhoneSectionLabel>
          {fromSessions.map((doc) => (
            <div key={doc.id} className="flex items-start gap-3 py-[13px] border-b border-[var(--color-structure-150)]" data-testid="document-row" data-id={doc.id}>
              <div className="w-[54px] flex-shrink-0 flex items-start justify-center pt-0.5" style={{ color: "var(--color-structure-500)" }}>
                <NotebookText size={16} strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="flex-1 text-sm leading-[1.45]">
                <div className="text-[var(--ink)] font-medium mb-[3px]">
                  {doc.title}
                </div>
                <div className="text-xs text-[var(--ink-muted)] mt-[3px]">
                  Written by {doc.builder}, {formatDate(doc.sent_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ★★ OWNERSHIP LINE */}
      <div className="text-xs text-[var(--ink-muted)] mt-4 leading-[1.6]">
        Everything here is yours. Tap any of it to download a copy, or ask for all of it at once from{" "}
        <button
          className="text-[var(--color-brand)] bg-none border-none p-0 cursor-pointer hover:underline"
          onClick={() => {
            if (onNavigate) onNavigate("/app/profile");
          }}
        >
          Account
        </button>
        .
      </div>
    </div>
  );
}
