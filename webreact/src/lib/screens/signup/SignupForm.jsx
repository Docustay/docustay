// ═══════════════════════════════════════════════════════════════════════════════════════════════
// R8.057 — SignupForm: port from webui/src/lib/screens/signup/SignupForm.svelte
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import Combobox from "@/lib/components/kit/Combobox.jsx";
import { Button } from "@/lib/components/ui/button.jsx";
import { Skeleton } from "@/lib/components/ui/skeleton.jsx";
import EmptyState from "@/lib/empty/EmptyState.jsx";
import { api } from "@/lib/api.js";

export default function SignupForm({
  businessName = "",
  onBusinessNameChange,
  foundBusiness = null,
  onFoundBusinessChange,
  earlyFinding = null,
  onEarlyFindingChange,
  onContinue,
}) {
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [noResults, setNoResults] = useState(false);
  const [notAvailable, setNotAvailable] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState(null);

  // Watch businessName prop and trigger search
  useEffect(() => {
    if (!businessName || businessName.trim().length < 2) {
      clearTimeout(searchTimeout);
      setSearchResults([]);
      setNoResults(false);
      setNotAvailable(false);
      setError(null);
      return;
    }

    clearTimeout(searchTimeout);
    setLoading(true);
    setError(null);
    setNoResults(false);
    setNotAvailable(false);

    const timeoutId = setTimeout(async () => {
      try {
        const response = await api.findBusinesses({ q: businessName.trim() });

        // If available is false, show the "It's not listed" path
        if (response.available === false) {
          setNotAvailable(true);
          setSearchResults([]);
          onFoundBusinessChange?.(null);
        } else if (response.results && response.results.length > 0) {
          setSearchResults(
            response.results.map((r) => ({
              value: JSON.stringify(r),
              label: r.name,
              data: r,
            }))
          );
          setNoResults(false);
        } else {
          setSearchResults([]);
          setNoResults(true);
        }
      } catch (err) {
        setError("Connection failed. Please try again.");
        setSearchResults([]);
      } finally {
        setLoading(false);
      }
    }, 300); // debounce window

    setSearchTimeout(timeoutId);
  }, [businessName]);

  // Handle business name input from Combobox
  function onSearchChange(value) {
    onBusinessNameChange?.(value);
  }

  // Handle selection from dropdown
  function onSelectBusiness(value) {
    try {
      const business = JSON.parse(value);
      onFoundBusinessChange?.(business);
      onBusinessNameChange?.(business.name);
      setSearchResults([]);
    } catch (e) {
      setError("Could not select this business");
    }
  }

  // Handle "It's not listed" selection
  function selectNotListed() {
    // Clear found business so we can type manually
    onFoundBusinessChange?.(null);
    setNotAvailable(false);
    setSearchResults([]);
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeout) clearTimeout(searchTimeout);
    };
  }, []);

  // Determine if Continue button should be enabled
  const canContinue = businessName.trim().length > 0;

  return (
    <div>
      {/* Headline */}
      <h1 className="mb-2 text-4xl font-semibold font-serif tracking-tight text-structure-900">
        What&rsquo;s your business called?
      </h1>

      {/* Subheadline */}
      <p className="mb-7 text-base text-structure-600 leading-relaxed">
        Start typing and we&rsquo;ll find it. That saves you filling in your address, phone and hours, and lets us
        look at how you&rsquo;re showing up online before you&rsquo;ve done anything.
      </p>

      {/* Search field */}
      <div className="mb-6">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <Combobox
            value={businessName}
            options={searchResults}
            placeholder="Search for your business…"
            onValueChange={onSelectBusiness}
            onInputChange={onSearchChange}
            testId="signup-business-search"
          />
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 rounded-lg bg-danger-50 border border-border-soft text-structure-900">
          {error}
        </div>
      )}

      {/* No results or "It's not listed" state */}
      {(noResults || notAvailable) && (
        <div className="mb-6">
          <EmptyState
            kind="filtered"
            headline="It's not listed"
            line="Type it in yourself instead"
            icon="IconBusiness"
          />
        </div>
      )}

      {(noResults || notAvailable) && (
        <Button
          onClick={selectNotListed}
          variant="outline"
          className="w-full mb-6"
        >
          Type it in yourself
        </Button>
      )}

      {/* Continue button */}
      <Button
        onClick={onContinue}
        disabled={!canContinue}
        className="w-full"
      >
        Continue
      </Button>
    </div>
  );
}
