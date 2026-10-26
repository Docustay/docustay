// DocumentChecker (SD.5) — public PDF verification page, no session required.
// Upload a signed PDF and see whether it has been validly signed and is unaltered.
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api.js";
import { Button } from "@/lib/components/ui/button";

export default function DocumentChecker() {
  const [file, setFile] = useState(null);
  const [phase, setPhase] = useState("idle");
  const [result, setResult] = useState(null);
  const [problem, setProblem] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => { document.title = "Verify a document"; }, []);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0] ?? null;
    setFile(selectedFile);
    setProblem(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setProblem("Please select a PDF file.");
      return;
    }

    setProblem(null);
    setPhase("checking");

    try {
      const res = await api.verifyDocument(file);
      setResult(res);
      setPhase("result");
    } catch (err) {
      let errorMsg = "Something went wrong. Please try again.";
      if (err instanceof ApiError) {
        errorMsg = err.body?.error?.message ?? errorMsg;
      }
      setProblem(errorMsg);
      setPhase("idle");
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-surface" data-testid="document-checker-page">
      <div className="flex flex-col gap-6 px-12 py-10">
        <div>
          <h1 className="m-0 text-page-title font-medium text-ink">Verify a document</h1>
          <p className="mt-2 mb-0 max-w-[62ch] text-body text-ink-2">Upload a PDF to check whether it was properly signed and hasn't been altered.</p>
        </div>

        {phase === "idle" && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="rounded-card border border-line bg-surface-2 p-6">
              <label htmlFor="pdf-input" className="mb-1.5 block text-ui font-medium text-ink">Choose a PDF file</label>
              <input
                id="pdf-input"
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                disabled={phase === "checking"}
                data-testid="document-checker-upload"
                className="block w-full text-sm"
              />
              {file && <p className="mt-2 text-caption text-mute">{file.name}</p>}
            </div>

            {problem && <p className="m-0 text-meta text-bad" role="alert" data-testid="document-checker-problem">{problem}</p>}

            <Button
              type="submit"
              disabled={!file || phase === "checking"}
              data-testid="document-checker-submit"
            >
              {phase === "checking" ? "Verifying…" : "Verify"}
            </Button>
          </form>
        )}

        {phase === "result" && result && (
          <div className="flex flex-col gap-4" data-testid="document-checker-result">
            {result.valid && result.signed ? (
              <div className="rounded-card border border-line bg-ok-soft p-6">
                <p className="m-0 text-body font-medium text-ok">This document is validly signed</p>
              </div>
            ) : (
              <div className="rounded-card border border-bad-border bg-bad-bg p-6">
                <p className="m-0 text-body font-medium text-bad">This document could not be verified</p>
                {result.reason && (
                  <p className="mt-3 mb-0 text-body text-bad" data-testid="document-checker-reason">
                    {result.reason}
                  </p>
                )}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFile(null);
                setPhase("idle");
                setResult(null);
                setProblem(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              data-testid="document-checker-reset"
            >
              Check another document
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
