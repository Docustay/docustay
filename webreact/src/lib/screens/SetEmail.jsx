// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.019 — SetEmail: rebuild from the frame on the archetype
//
// Surfaces the Resend domain configuration: domain name, verification state (verified/awaiting_dns),
// exact DNS records to add (copyable), banner sentence about platform domain fallback, and
// deliverability health read from emailDomainHealth.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import PageHeader from "@/lib/lists/PageHeader.jsx";
import LastChanged from "@/lib/shared/LastChanged.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { RANK_ORDER } from "@/lib/permissions/rank.js";

const STATE_WORDS = {
  verified: "Domain verified",
  awaiting_dns: "Awaiting DNS configuration",
};

const STATE_HELP = {
  verified: "Emails send from your domain.",
  awaiting_dns: "Add these DNS records to verify your domain.",
};

export default function SetEmail({ domain = null, verificationState = null, dnsRecords = [], deliverabilityHealth = null, lastChanged = null, rank = null }) {
  const [copied, setCopied] = useState(null);
  const [loading, setLoading] = useState(false);

  const isAdmin = RANK_ORDER.indexOf(rank ?? "") >= RANK_ORDER.indexOf("admin");

  function copyDnsRecord(record) {
    const text = `${record.name} ${record.type} ${record.value}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(record.name);
      setTimeout(() => {
        setCopied(null);
      }, 2000);
    });
  }

  return (
    <div className="px-6 py-6">
      <PageHeader title="Email — Sending domain" />

      {domain ? (
        <div className="max-w-[600px]">
          {/* Domain Header */}
          <div className="mb-6 flex items-center justify-between border-b border-line pb-4">
            <div className="text-lg font-semibold text-ink">{domain}</div>
            <div
              className={`inline-block rounded-chip px-3 py-1 text-caption font-medium ${
                verificationState === "verified"
                  ? "bg-ok-soft text-ok"
                  : "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
              }`}
              data-state={verificationState || "awaiting_dns"}
            >
              {STATE_WORDS[verificationState] || "Awaiting DNS"}
            </div>
          </div>

          {/* State Help */}
          <p className="mb-6 text-sm text-mute">{STATE_HELP[verificationState] || ""}</p>

          {/* DNS Records Section */}
          {verificationState === "awaiting_dns" && dnsRecords.length > 0 && (
            <div className="mb-8">
              <h3 className="mb-4 text-sm font-semibold text-ink">Add these DNS records</h3>
              <div className="overflow-hidden rounded-control border border-line">
                {dnsRecords.map((record, idx) => (
                  <div
                    key={record.name}
                    className={`flex items-center justify-between gap-4 p-4 ${idx < dnsRecords.length - 1 ? "border-b border-hair" : ""}`}
                  >
                    <div className="flex flex-1 gap-4">
                      <div className="flex min-w-fit items-center rounded-control bg-mute-bg p-2 font-mono text-xs font-semibold text-center">
                        {record.type}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs uppercase text-mute-decor">
                          {record.name}
                        </div>
                        <div className="font-mono text-sm text-ink break-all">
                          {record.value}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyDnsRecord(record)}
                      title="Copy DNS record"
                      className="whitespace-nowrap text-sm"
                    >
                      {copied === record.name ? "Copied" : "Copy"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fallback Banner */}
          <div className="mb-8 rounded-control border-l-4 border-[var(--color-signer-client-ink)] bg-[var(--color-signer-client-bg)] p-4">
            <p className="m-0 text-sm text-[var(--color-signer-client-ink)]">
              {verificationState === "verified"
                ? "Emails send from your domain."
                : "Emails send via the platform domain with a visible banner until verified."}
            </p>
          </div>

          {/* Deliverability Health Section */}
          {deliverabilityHealth && (
            <div className="border-t border-line pt-8">
              <h3 className="mb-2 text-sm font-semibold text-ink">Deliverability</h3>
              <p className="text-sm text-mute">{deliverabilityHealth}</p>
            </div>
          )}

          {/* Last Changed */}
          {lastChanged && <LastChanged {...lastChanged} />}
        </div>
      ) : (
        <div className="py-8 text-center text-mute">
          <p>No sending domain configured.</p>
        </div>
      )}
    </div>
  );
}
