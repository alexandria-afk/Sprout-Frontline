"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import * as svc from "@/services/onboarding";
import { apiFetch } from "@/services/api/client";
import { getAttendanceRules, updateAttendanceRules } from "@/services/shifts";
import type {
  OnboardingSession,
  CompanyProfile,
  IndustryPackage,
  TemplateCategoryGroup,
  OnboardingLocation,
  OnboardingAsset,
  OnboardingVendor,
  OnboardingEmployee,
  RoleMapping,
  WorkspacePreview,
  LaunchProgress,
} from "@/services/onboarding";

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: "Company" },
  { n: 2, label: "Team" },
  { n: 3, label: "Shifts" },
  { n: 4, label: "Assets" },
  { n: 5, label: "Vendors" },
  { n: 6, label: "Templates" },
  { n: 7, label: "Preview" },
  { n: 8, label: "Launch" },
];

const INDUSTRIES = [
  { code: "qsr", label: "Quick Service Restaurant" },
  { code: "casual_dining", label: "Casual Dining Restaurant" },
  { code: "full_service_restaurant", label: "Full-Service Restaurant" },
  { code: "cafe_bar", label: "Cafe & Bar" },
  { code: "bakery", label: "Bakery & Pastry" },
  { code: "retail_fashion", label: "Retail — Fashion & Apparel" },
  { code: "retail_grocery", label: "Retail — Grocery & Convenience" },
  { code: "hospitality", label: "Hospitality & Hotels" },
  { code: "healthcare_clinic", label: "Healthcare — Clinics" },
  { code: "manufacturing", label: "Manufacturing" },
  { code: "logistics", label: "Logistics & Warehousing" },
];

const EMPLOYEE_SOURCES = [
  { id: "csv", icon: "📄", label: "Import CSV", desc: "Upload a spreadsheet of your team" },
  { id: "manual", icon: "✍️", label: "Add Manually", desc: "Enter employees one by one" },
  { id: "invite_link", icon: "🔗", label: "Invite Link", desc: "Send a link for staff to join" },
  { id: "sprout_hr", icon: "🌱", label: "Sprout HR", desc: "Sync from Sprout HR (coming soon)", disabled: true },
];

const CATEGORY_ICONS: Record<string, string> = {
  form: "📋",
  checklist: "✅",
  audit: "🔍",
  issue_category: "⚠️",
  workflow: "⚡",
  training_module: "🎓",
  shift_template: "📅",
  repair_manual: "🔧",
  badge: "🏅",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function StepHeader({ step, title, subtitle }: { step: number; title: string; subtitle: string }) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-green-600 uppercase tracking-wider">
          Step {step} of {STEPS.length}
        </span>
      </div>
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      <p className="text-slate-500 mt-1">{subtitle}</p>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("bg-white rounded-2xl border border-slate-200 shadow-sm", className)}>
      {children}
    </div>
  );
}

// ── Step Progress Bar ─────────────────────────────────────────────────────────

function StepBar({ current, maxReached, onGoTo }: { current: number; maxReached: number; onGoTo: (n: number) => void }) {
  return (
    <div className="flex items-center gap-0 mb-10">
      {STEPS.map((s, i) => {
        const isCompleted = s.n < maxReached;
        const isCurrent = s.n === current;
        const isClickable = s.n < maxReached && s.n !== current;
        return (
          <div key={s.n} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <button
                type="button"
                onClick={() => isClickable && onGoTo(s.n)}
                disabled={!isClickable}
                className={clsx(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                  isCompleted
                    ? "bg-green-500 text-white hover:bg-green-600 cursor-pointer"
                    : isCurrent
                    ? "bg-green-600 text-white ring-4 ring-green-100 cursor-default"
                    : "bg-slate-100 text-slate-400 cursor-default"
                )}
              >
                {isCompleted ? "✓" : s.n}
              </button>
              <span
                className={clsx(
                  "text-xs mt-1 font-medium",
                  s.n <= maxReached ? "text-slate-700" : "text-slate-400"
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={clsx(
                  "h-0.5 flex-1 mx-1 mb-4 transition-colors",
                  s.n < maxReached ? "bg-green-400" : "bg-slate-200"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Company Discovery
// ═══════════════════════════════════════════════════════════════════════════════

function Step1({
  session,
  onNext,
}: {
  session: OnboardingSession;
  onNext: (updated: OnboardingSession) => void;
}) {
  // Pre-populate from session when navigating back
  const restoredProfile: CompanyProfile | null = session.company_name
    ? {
        company_name: session.company_name,
        industry_code: session.industry_code ?? "qsr",
        industry_subcategory: null,
        estimated_locations: session.estimated_locations ?? null,
        brand_color_hex: session.brand_color ?? null,
        logo_url: session.logo_url ?? null,
        confidence: 1.0,
      }
    : null;

  const [url, setUrl] = useState(session.website_url ?? "");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<CompanyProfile | null>(restoredProfile);
  const [error, setError] = useState("");
  const [fallbackMode, setFallbackMode] = useState(false);
  const [fallback, setFallback] = useState({
    company_name: session.company_name ?? "",
    industry_code: session.industry_code ?? "qsr",
    estimated_locations: session.estimated_locations ?? ("" as string | number),
  });
  const [confirming, setConfirming] = useState(false);
  // True once company has been saved this session (or was already saved on a previous visit)
  const [companyConfirmed, setCompanyConfirmed] = useState(session.current_step >= 2);

  // ── Locations (embedded in step 1, shown after company confirmed) ────────
  const [locations, setLocations] = useState<OnboardingLocation[]>([]);
  const [locSuggestions, setLocSuggestions] = useState<OnboardingLocation[]>([]);
  const [locSuggestionsVisible, setLocSuggestionsVisible] = useState(50);
  const [locsLoading, setLocsLoading] = useState(false);
  const [locForm, setLocForm] = useState({ name: "", address: "" });
  const [showLocForm, setShowLocForm] = useState(false);
  const [locSaving, setLocSaving] = useState(false);
  const [locError, setLocError] = useState("");
  const locSuggestRan = useRef(false);

  // Load existing locations + fetch AI suggestions (without auto-saving) once confirmed
  useEffect(() => {
    if (!companyConfirmed || !profile || locSuggestRan.current) return;
    locSuggestRan.current = true;
    setLocsLoading(true);
    Promise.all([
      svc.listLocations(session.session_id),
      svc.suggestLocations(session.session_id),
    ])
      .then(([saved, suggested]) => {
        setLocations(saved);
        // Only show suggestions that aren't already saved
        const savedNames = new Set(saved.map((l) => l.name.toLowerCase()));
        setLocSuggestions(suggested.filter((s) => !savedNames.has(s.name.toLowerCase())));
        setLocSuggestionsVisible(50);
      })
      .catch((err) => {
        console.error("Failed to load location suggestions:", err);
        setLocError("Failed to load location suggestions. Please try again.");
      })
      .finally(() => setLocsLoading(false));
  }, [companyConfirmed, profile, session.session_id]);

  const refreshLocs = () =>
    svc.listLocations(session.session_id).then(setLocations).catch(() => {});

  const refreshSuggestions = () => {
    locSuggestRan.current = false;
    setLocsLoading(true);
    Promise.all([
      svc.listLocations(session.session_id),
      svc.suggestLocations(session.session_id),
    ])
      .then(([saved, suggested]) => {
        setLocations(saved);
        const savedNames = new Set(saved.map((l) => l.name.toLowerCase()));
        setLocSuggestions(suggested.filter((s) => !savedNames.has(s.name.toLowerCase())));
        setLocSuggestionsVisible(50);
      })
      .catch((err) => {
        console.error("Failed to refresh location suggestions:", err);
        setLocError("Failed to load location suggestions. Please try again.");
      })
      .finally(() => setLocsLoading(false));
  };

  const handleAcceptSuggestion = async (suggestion: OnboardingLocation) => {
    try {
      await svc.addLocation(session.session_id, { name: suggestion.name, address: suggestion.address || null });
      setLocSuggestions((prev) => prev.filter((s) => s.name !== suggestion.name));
      await refreshLocs();
    } catch {
      setLocError("Failed to add location.");
    }
  };

  const handleDismissSuggestion = (suggestion: OnboardingLocation) => {
    setLocSuggestions((prev) => prev.filter((s) => s.name !== suggestion.name));
  };

  const [addingAll, setAddingAll] = useState(false);
  const handleAddAllSuggestions = async () => {
    const batch = locSuggestions.slice(0, locSuggestionsVisible);
    setAddingAll(true);
    try {
      await Promise.all(
        batch.map((s) =>
          svc.addLocation(session.session_id, { name: s.name, address: s.address || null })
        )
      );
      setLocSuggestions((prev) => prev.slice(locSuggestionsVisible));
      setLocSuggestionsVisible(50);
      await refreshLocs();
    } catch {
      setLocError("Failed to add some locations.");
    } finally {
      setAddingAll(false);
    }
  };

  const handleAddLoc = async () => {
    if (!locForm.name.trim()) return;
    setLocSaving(true);
    try {
      await svc.addLocation(session.session_id, { name: locForm.name.trim(), address: locForm.address.trim() || null });
      setLocForm({ name: "", address: "" });
      setShowLocForm(false);
      await refreshLocs();
    } catch {
      setLocError("Failed to add location.");
    } finally {
      setLocSaving(false);
    }
  };

  const handleDeleteLoc = async (id: string) => {
    try {
      await svc.deleteLocation(session.session_id, id);
      await refreshLocs();
    } catch {
      setLocError("Failed to remove location.");
    }
  };

  const discover = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setProfile(null);
    try {
      const p = await svc.discoverCompany(session.session_id, url.trim());
      setProfile(p);
    } catch {
      setError("Couldn't analyse that website. Enter your details manually below.");
      setFallbackMode(true);
    } finally {
      setLoading(false);
    }
  };

  const discoverFallback = async () => {
    if (!fallback.company_name || !fallback.industry_code) return;
    setLoading(true);
    setError("");
    try {
      const p = await svc.discoverFallback(session.session_id, {
        company_name: fallback.company_name,
        industry_code: fallback.industry_code,
        estimated_locations: fallback.estimated_locations
          ? Number(fallback.estimated_locations)
          : undefined,
      });
      setProfile(p);
      setFallbackMode(false);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!profile) return;
    setConfirming(true);
    try {
      await svc.confirmCompany(session.session_id, profile);
      // Don't advance to next step yet — stay on step 1 to set up locations
      setCompanyConfirmed(true);
      locSuggestRan.current = false;
      setConfirming(false);
    } catch {
      setError("Failed to save. Try again.");
      setConfirming(false);
    }
  };

  const handleContinueToTemplates = async () => {
    setConfirming(true);
    try {
      const fresh = await svc.getCurrentSession();
      onNext(fresh!);
    } catch {
      setError("Failed to continue.");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div>
      <StepHeader
        step={1}
        title="Tell us about your company"
        subtitle="Analyse your website to pre-fill your workspace, or connect your HR system."
      />

      {!profile && !fallbackMode && (
        <div className="space-y-3 mb-4">
          <Card className="p-6">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Company website
            </label>
            <div className="flex gap-3">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && discover()}
                placeholder="https://yourcompany.com"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                onClick={discover}
                disabled={loading || !url.trim()}
                className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? <><Spinner size={14} /><span>Analysing…</span></> : "Analyse"}
              </button>
            </div>
            {loading && (
              <p className="text-slate-400 text-xs mt-2">Fetching your company details — this takes about 10 seconds…</p>
            )}
            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
            <button
              onClick={() => setFallbackMode(true)}
              className="text-xs text-slate-400 underline mt-3 block"
            >
              Enter details manually instead
            </button>
          </Card>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-medium">or</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <button
            disabled
            className="w-full flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed text-left"
          >
            <span className="text-2xl">🌱</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">Connect to Sprout HR</span>
                <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">Coming Soon</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Automatically sync your company, locations and team from Sprout HR</p>
            </div>
          </button>
        </div>
      )}

      {fallbackMode && !profile && (
        <Card className="p-6 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Enter your company details</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Company name *</label>
              <input
                value={fallback.company_name}
                onChange={(e) => setFallback((f) => ({ ...f, company_name: e.target.value }))}
                placeholder="Acme Corp"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Industry *</label>
              <select
                value={fallback.industry_code}
                onChange={(e) => setFallback((f) => ({ ...f, industry_code: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {INDUSTRIES.map((i) => (
                  <option key={i.code} value={i.code}>{i.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Estimated locations</label>
              <input
                type="number"
                min={1}
                value={fallback.estimated_locations}
                onChange={(e) => setFallback((f) => ({ ...f, estimated_locations: e.target.value }))}
                placeholder="e.g. 5"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
          <div className="flex gap-3 mt-5">
            <button
              onClick={() => { setFallbackMode(false); setError(""); }}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm"
            >
              Back
            </button>
            <button
              onClick={discoverFallback}
              disabled={loading || !fallback.company_name}
              className="flex-1 px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Spinner size={16} /> : "Continue"}
            </button>
          </div>
        </Card>
      )}

      {loading && !profile && !fallbackMode && (
        <Card className="p-10 flex flex-col items-center gap-3 mb-4">
          <Spinner size={32} />
          <p className="text-slate-500 text-sm">Analysing your website with AI…</p>
        </Card>
      )}

      {profile && (
        <div className="space-y-4">
          <Card className="p-6">
            <div className="flex items-start gap-4">
              {profile.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.logo_url} alt="Logo" className="w-16 h-16 rounded-lg object-contain border border-slate-100" />
              )}
              {profile.brand_color_hex && (
                <div
                  className="w-10 h-10 rounded-full border border-slate-200 flex-shrink-0"
                  style={{ backgroundColor: profile.brand_color_hex }}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-900">{profile.company_name}</h2>
                  {profile.confidence >= 0.8 && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                      High confidence
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-500 mt-0.5">
                  {INDUSTRIES.find((i) => i.code === profile.industry_code)?.label ?? profile.industry_code}
                  {profile.industry_subcategory && ` · ${profile.industry_subcategory}`}
                </p>
                {profile.estimated_locations && (
                  <p className="text-xs text-slate-400 mt-1">~{profile.estimated_locations} locations</p>
                )}
              </div>
            </div>

            <div className="mt-5 pt-5 border-t border-slate-100 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Company name</label>
                <input
                  value={profile.company_name}
                  onChange={(e) => setProfile((p) => p && { ...p, company_name: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Industry</label>
                <select
                  value={profile.industry_code}
                  onChange={(e) => setProfile((p) => p && { ...p, industry_code: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  {INDUSTRIES.map((i) => (
                    <option key={i.code} value={i.code}>{i.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Brand colour</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={profile.brand_color_hex ?? "#16a34a"}
                    onChange={(e) => setProfile((p) => p && { ...p, brand_color_hex: e.target.value })}
                    className="w-10 h-10 rounded border border-slate-200 cursor-pointer"
                  />
                  <span className="text-sm text-slate-500">{profile.brand_color_hex}</span>
                </div>
              </div>
            </div>
          </Card>

          <div className="flex gap-3">
            <button
              onClick={() => { setProfile(null); setUrl(""); locSuggestRan.current = false; setLocations([]); }}
              className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm"
            >
              Start over
            </button>
            <button
              onClick={confirm}
              disabled={confirming || companyConfirmed}
              className="flex-1 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {confirming ? <Spinner size={16} /> : companyConfirmed ? "Company confirmed ✓" : "Confirm Company →"}
            </button>
          </div>

          {/* ── Locations section (shown after company confirmed) ──────────── */}
          {companyConfirmed && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-slate-800">Your locations</h3>
                <button
                  onClick={refreshSuggestions}
                  disabled={locsLoading}
                  className="text-xs text-slate-400 hover:text-green-600 disabled:opacity-40 flex items-center gap-1 transition-colors"
                  title="Re-scan website for locations"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={locsLoading ? "animate-spin" : ""}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                  Re-scan
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Add your branches, stores, or outlets. You can also add locations later when importing your team.
              </p>
              {locError && <p className="text-xs text-red-500 mb-2">{locError}</p>}
              {locsLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400 py-6 justify-center">
                  <Spinner size={16} />
                  <span>Scanning website for locations…</span>
                </div>
              ) : (
                <div className="space-y-3 mb-4">
                  {/* AI suggestions — unconfirmed */}
                  {locSuggestions.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-amber-700">
                          ✨ Found from your website — add the ones that apply
                        </p>
                        <button
                          onClick={handleAddAllSuggestions}
                          disabled={addingAll}
                          className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors shrink-0"
                        >
                          {addingAll ? "Adding…" : `Add these ${Math.min(locSuggestionsVisible, locSuggestions.length)}`}
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {locSuggestions.slice(0, locSuggestionsVisible).map((s, i) => (
                          <div key={i} className="flex items-start justify-between gap-2 bg-white border border-amber-100 rounded-lg px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{s.name}</p>
                              {s.address && <p className="text-xs text-slate-400 mt-0.5 truncate">{s.address}</p>}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => handleAcceptSuggestion(s)}
                                className="text-xs bg-green-600 text-white px-2.5 py-1 rounded-lg hover:bg-green-700 transition-colors"
                              >
                                + Add
                              </button>
                              <button
                                onClick={() => handleDismissSuggestion(s)}
                                className="text-xs text-slate-300 hover:text-red-400 px-1 py-1"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ))}
                        {locSuggestions.length > locSuggestionsVisible && (
                          <button
                            onClick={() => setLocSuggestionsVisible((v) => v + 50)}
                            className="w-full text-xs text-amber-600 hover:text-amber-800 py-2 text-center transition-colors"
                          >
                            Show {Math.min(50, locSuggestions.length - locSuggestionsVisible)} more
                            <span className="text-amber-400 ml-1">({locSuggestions.length - locSuggestionsVisible} remaining)</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Confirmed / saved locations */}
                  {locations.map((loc) => (
                    <div key={loc.id} className="flex items-start justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">{loc.name}</p>
                        {loc.address && <p className="text-xs text-slate-400 mt-0.5">{loc.address}</p>}
                      </div>
                      <button onClick={() => handleDeleteLoc(loc.id!)} className="text-xs text-slate-300 hover:text-red-400 ml-4 mt-0.5">✕</button>
                    </div>
                  ))}

                  {/* Manual add form */}
                  {showLocForm ? (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-2">
                      <input
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="Location name (e.g. Makati Branch)"
                        value={locForm.name}
                        onChange={(e) => setLocForm((f) => ({ ...f, name: e.target.value }))}
                      />
                      <input
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                        placeholder="Address (optional)"
                        value={locForm.address}
                        onChange={(e) => setLocForm((f) => ({ ...f, address: e.target.value }))}
                      />
                      <div className="flex gap-2">
                        <button onClick={handleAddLoc} disabled={locSaving || !locForm.name.trim()} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                          {locSaving ? "Adding…" : "Add"}
                        </button>
                        <button onClick={() => { setShowLocForm(false); setLocForm({ name: "", address: "" }); }} className="text-xs text-slate-400 px-2 py-1.5">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowLocForm(true)} className="w-full text-sm text-slate-400 hover:text-green-600 border border-dashed border-slate-200 hover:border-green-400 rounded-xl py-3 transition-colors">
                      + Add location manually
                    </button>
                  )}
                </div>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleContinueToTemplates}
                  disabled={confirming}
                  className="flex-1 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {confirming ? <Spinner size={16} /> : locations.length === 0 ? "Skip locations — Continue →" : "Looks good — Continue →"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Template Selection
// ═══════════════════════════════════════════════════════════════════════════════

function Step2({
  session,
  onNext,
}: {
  session: OnboardingSession;
  onNext: (updated: OnboardingSession) => void;
}) {
  const [pkg, setPkg] = useState<IndustryPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    svc.getTemplates(session.session_id)
      .then((p) => { setPkg(p); setExpanded(p.categories[0]?.category ?? null); })
      .catch(() => setError("Failed to load templates."))
      .finally(() => setLoading(false));
  }, [session.session_id]);

  const toggleItem = useCallback(
    async (templateId: string, currentlySelected: boolean) => {
      if (!pkg) return;
      const newValue = !currentlySelected;
      // Optimistic update
      setPkg((prev) => {
        if (!prev) return prev;
        const cats = prev.categories.map((cat) => ({
          ...cat,
          items: cat.items.map((item) =>
            item.id === templateId ? { ...item, is_selected: newValue } : item
          ),
          selected_count: cat.items.reduce(
            (acc, item) =>
              item.id === templateId
                ? acc + (newValue ? 1 : -1)
                : acc + (item.is_selected ? 1 : 0),
            0
          ),
        }));
        const total = cats.reduce((a, c) => a + c.selected_count, 0);
        return { ...prev, categories: cats, total_selected: total };
      });
      await svc.updateSelections(session.session_id, [{ template_id: templateId, is_selected: newValue }]);
    },
    [pkg, session.session_id]
  );

  const selectAll = useCallback(
    async (cat: TemplateCategoryGroup) => {
      const allSelected = cat.items.every((i) => i.is_selected);
      const updates = cat.items.map((i) => ({ template_id: i.id, is_selected: !allSelected }));
      setPkg((prev) => {
        if (!prev) return prev;
        const cats = prev.categories.map((c) =>
          c.category === cat.category
            ? { ...c, items: c.items.map((i) => ({ ...i, is_selected: !allSelected })), selected_count: allSelected ? 0 : c.total_count }
            : c
        );
        const total = cats.reduce((a, c) => a + c.selected_count, 0);
        return { ...prev, categories: cats, total_selected: total };
      });
      await svc.updateSelections(session.session_id, updates);
    },
    [session.session_id]
  );

  const confirm = async () => {
    setSaving(true);
    try {
      const updated = await svc.confirmTemplates(session.session_id);
      onNext(updated);
    } catch {
      setError("Failed to save selections.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Spinner size={32} />
    </div>
  );

  return (
    <div>
      <StepHeader
        step={2}
        title="Choose your starter templates"
        subtitle="We've pre-selected templates for your industry. Adjust to taste — you can add more later."
      />

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {pkg && (
        <>
          {/* Summary bar */}
          <div className="flex items-center justify-between mb-5 py-3 px-4 bg-green-50 rounded-xl border border-green-100">
            <span className="text-sm text-slate-600">
              <span className="font-bold text-green-700">{pkg.total_selected}</span> of {pkg.total_available} templates selected
            </span>
            <div className="flex gap-3 text-xs text-slate-500">
              {pkg.categories.map((c) => (
                <span key={c.category}>
                  {CATEGORY_ICONS[c.category]} {c.selected_count}
                </span>
              ))}
            </div>
          </div>

          {/* Categories accordion */}
          <div className="space-y-3">
            {pkg.categories.map((cat) => {
              const isOpen = expanded === cat.category;
              const allSelected = cat.items.every((i) => i.is_selected);
              return (
                <Card key={cat.category}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : cat.category)}
                    className="w-full flex items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{CATEGORY_ICONS[cat.category] ?? "📋"}</span>
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{cat.display_name}</div>
                        <div className="text-xs text-slate-400">{cat.selected_count} of {cat.total_count} selected</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); selectAll(cat); }}
                        className="text-xs text-green-600 font-medium hover:underline"
                      >
                        {allSelected ? "Deselect all" : "Select all"}
                      </button>
                      <svg
                        className={clsx("w-4 h-4 text-slate-400 transition-transform", isOpen && "rotate-180")}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100 divide-y divide-slate-50">
                      {cat.items.map((item) => (
                        <label
                          key={item.id}
                          className="flex items-start gap-3 p-4 cursor-pointer hover:bg-slate-50 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={item.is_selected}
                            onChange={() => toggleItem(item.id, item.is_selected)}
                            className="mt-0.5 w-4 h-4 accent-green-600 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-slate-800">{item.name}</span>
                              {item.is_recommended && (
                                <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                                  Recommended
                                </span>
                              )}
                            </div>
                            {item.description && (
                              <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          <button
            onClick={confirm}
            disabled={saving || pkg.total_selected === 0}
            className="mt-6 w-full px-5 py-3 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Spinner size={16} /> : `Confirm ${pkg.total_selected} templates — Continue →`}
          </button>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Locations
// ═══════════════════════════════════════════════════════════════════════════════

function Step3Locations({
  session,
  onNext,
}: {
  session: OnboardingSession;
  onNext: (updated: OnboardingSession) => void;
}) {
  const [locations, setLocations] = useState<OnboardingLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", address: "" });
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const suggestRanRef = useRef(false);

  useEffect(() => {
    if (suggestRanRef.current) return;
    suggestRanRef.current = true;
    setLoading(true);
    svc.listLocations(session.session_id)
      .then((locs) => {
        if (locs.length === 0) {
          // Auto-suggest on first load
          return svc.suggestLocations(session.session_id).then((suggestions) =>
            Promise.all(suggestions.map((s) => svc.addLocation(session.session_id, s)))
              .then(() => svc.listLocations(session.session_id))
          );
        }
        return locs;
      })
      .then(setLocations)
      .catch(() => setLocations([]))
      .finally(() => setLoading(false));
  }, [session.session_id]);

  const refresh = () =>
    svc.listLocations(session.session_id).then(setLocations).catch(() => {});

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await svc.addLocation(session.session_id, { name: form.name.trim(), address: form.address.trim() || null });
      setForm({ name: "", address: "" });
      setShowForm(false);
      await refresh();
    } catch {
      setError("Failed to add location.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await svc.deleteLocation(session.session_id, id);
      await refresh();
    } catch {
      setError("Failed to remove location.");
    }
  };

  const handleContinue = async () => {
    setSubmitting(true);
    try {
      const updated = await svc.confirmLocations(session.session_id);
      onNext(updated);
    } catch {
      setError("Failed to continue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-800">Your Locations</h2>
        <p className="text-sm text-slate-500 mt-1">
          Add your stores, branches, or outlets. These will be used to assign employees and assets.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <div className="text-sm text-slate-400 py-8 text-center">AI is suggesting your locations…</div>
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-start justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{loc.name}</p>
                {loc.address && <p className="text-xs text-slate-400 mt-0.5">{loc.address}</p>}
              </div>
              <button
                onClick={() => handleDelete(loc.id!)}
                className="text-xs text-slate-300 hover:text-red-400 transition-colors ml-4 mt-0.5"
              >
                ✕
              </button>
            </div>
          ))}

          {showForm ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-2">
              <input
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Location name (e.g. Makati Branch)"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <input
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Address (optional)"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={saving || !form.name.trim()}
                  className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {saving ? "Adding…" : "Add"}
                </button>
                <button
                  onClick={() => { setShowForm(false); setForm({ name: "", address: "" }); }}
                  className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="w-full text-sm text-slate-400 hover:text-green-600 border border-dashed border-slate-200 hover:border-green-400 rounded-xl py-3 transition-colors"
            >
              + Add location
            </button>
          )}
        </div>
      )}

      <button
        onClick={handleContinue}
        disabled={submitting || loading}
        className="w-full bg-green-600 text-white text-sm font-semibold py-3 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        {submitting ? "Saving…" : "Continue →"}
      </button>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Assets & Vendors
// ═══════════════════════════════════════════════════════════════════════════════

function Step4Assets({
  session,
  onNext,
}: {
  session: OnboardingSession;
  onNext: (updated: OnboardingSession) => void;
}) {
  const [assets, setAssets] = useState<OnboardingAsset[]>([]);
  const [locations, setLocations] = useState<OnboardingLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [assetForm, setAssetForm] = useState({ name: "", category: "", model: "", manufacturer: "", location_name: "" });
  const [showAssetForm, setShowAssetForm] = useState(false);
  const suggestRanRef = useRef(false);

  useEffect(() => {
    if (suggestRanRef.current) return;
    suggestRanRef.current = true;
    setLoading(true);
    Promise.all([
      svc.listAssets(session.session_id),
      svc.listLocations(session.session_id),
    ]).then(([a, l]) => {
      setAssets(a);
      setLocations(l);
      if (a.length === 0) {
        return svc.suggestAssets(session.session_id)
          .then((suggestions) => Promise.all(suggestions.map((s) => svc.addAsset(session.session_id, s))))
          .then(() => svc.listAssets(session.session_id))
          .then(setAssets)
          .catch(() => {});
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, [session.session_id]);

  const refreshAssets = () => svc.listAssets(session.session_id).then(setAssets).catch(() => {});

  const handleAddAsset = async () => {
    if (!assetForm.name.trim() || !assetForm.category.trim()) return;
    setSaving(true);
    try {
      await svc.addAsset(session.session_id, {
        name: assetForm.name.trim(),
        category: assetForm.category.trim(),
        model: assetForm.model.trim() || null,
        manufacturer: assetForm.manufacturer.trim() || null,
        location_name: assetForm.location_name || null,
      });
      setAssetForm({ name: "", category: "", model: "", manufacturer: "", location_name: "" });
      setShowAssetForm(false);
      await refreshAssets();
    } catch {
      setError("Failed to add asset.");
    } finally {
      setSaving(false);
    }
  };

  const handleContinue = async () => {
    setSubmitting(true);
    try {
      const updated = await svc.confirmAssets(session.session_id);
      onNext(updated);
    } catch {
      setError("Failed to continue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <StepHeader
        step={4}
        title="Assets"
        subtitle="Register your equipment. AI will generate repair guides for each asset. You can skip this and add later."
      />

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <div className="text-sm text-slate-400 py-8 text-center">AI is suggesting assets for your industry…</div>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <div key={a.id} className="flex items-start justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{a.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {a.category}{a.model ? ` · ${a.model}` : ""}{a.location_name ? ` · ${a.location_name}` : ""}
                </p>
              </div>
              <button onClick={() => svc.deleteAsset(session.session_id, a.id!).then(refreshAssets)} className="text-xs text-slate-300 hover:text-red-400 transition-colors ml-4 mt-0.5">✕</button>
            </div>
          ))}
          {showAssetForm ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-2">
              <input className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Asset name*" value={assetForm.name} onChange={(e) => setAssetForm((f) => ({ ...f, name: e.target.value }))} />
              <input className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Category*" value={assetForm.category} onChange={(e) => setAssetForm((f) => ({ ...f, category: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <input className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Model (optional)" value={assetForm.model} onChange={(e) => setAssetForm((f) => ({ ...f, model: e.target.value }))} />
                <input className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Manufacturer (optional)" value={assetForm.manufacturer} onChange={(e) => setAssetForm((f) => ({ ...f, manufacturer: e.target.value }))} />
              </div>
              {locations.length > 0 && (
                <select className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" value={assetForm.location_name} onChange={(e) => setAssetForm((f) => ({ ...f, location_name: e.target.value }))}>
                  <option value="">Location (optional)</option>
                  {locations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              )}
              <div className="flex gap-2">
                <button onClick={handleAddAsset} disabled={saving || !assetForm.name.trim() || !assetForm.category.trim()} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">{saving ? "Adding…" : "Add"}</button>
                <button onClick={() => { setShowAssetForm(false); setAssetForm({ name: "", category: "", model: "", manufacturer: "", location_name: "" }); }} className="text-xs text-slate-400 px-2 py-1.5">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowAssetForm(true)} className="w-full text-sm text-slate-400 hover:text-green-600 border border-dashed border-slate-200 hover:border-green-400 rounded-xl py-3 transition-colors">+ Add asset</button>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={handleContinue} disabled={submitting || loading} className="flex-1 bg-green-600 text-white text-sm font-semibold py-3 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors">
          {submitting ? "Saving…" : assets.length === 0 ? "Skip assets — Continue →" : "Continue →"}
        </button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Vendors
// ═══════════════════════════════════════════════════════════════════════════════

function Step5Vendors({
  session,
  onNext,
}: {
  session: OnboardingSession;
  onNext: (updated: OnboardingSession) => void;
}) {
  const [vendors, setVendors] = useState<OnboardingVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [vendorForm, setVendorForm] = useState({ name: "", service_type: "", contact_email: "", contact_phone: "" });
  const [showVendorForm, setShowVendorForm] = useState(false);

  useEffect(() => {
    svc.listVendors(session.session_id).then(setVendors).catch(() => setVendors([])).finally(() => setLoading(false));
  }, [session.session_id]);

  const refreshVendors = () => svc.listVendors(session.session_id).then(setVendors).catch(() => {});

  const handleAddVendor = async () => {
    if (!vendorForm.name.trim()) return;
    setSaving(true);
    try {
      await svc.addVendor(session.session_id, {
        name: vendorForm.name.trim(),
        service_type: vendorForm.service_type.trim() || null,
        contact_email: vendorForm.contact_email.trim() || null,
        contact_phone: vendorForm.contact_phone.trim() || null,
      });
      setVendorForm({ name: "", service_type: "", contact_email: "", contact_phone: "" });
      setShowVendorForm(false);
      await refreshVendors();
    } catch {
      setError("Failed to add vendor.");
    } finally {
      setSaving(false);
    }
  };

  const handleContinue = async () => {
    setSubmitting(true);
    try {
      const updated = await svc.confirmVendors(session.session_id);
      onNext(updated);
    } catch {
      setError("Failed to continue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <StepHeader
        step={5}
        title="Vendors"
        subtitle="Add your service providers and suppliers. AI will link them to your assets. You can skip this and add later."
      />

      {error && <p className="text-sm text-red-500">{error}</p>}

      {loading ? (
        <div className="text-sm text-slate-400 py-8 text-center"><Spinner size={20} /></div>
      ) : (
        <div className="space-y-2">
          {vendors.map((v) => (
            <div key={v.id} className="flex items-start justify-between bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{v.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{[v.service_type, v.contact_email, v.contact_phone].filter(Boolean).join(" · ")}</p>
              </div>
              <button onClick={() => svc.deleteVendor(session.session_id, v.id!).then(refreshVendors)} className="text-xs text-slate-300 hover:text-red-400 ml-4 mt-0.5">✕</button>
            </div>
          ))}
          {showVendorForm ? (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-2">
              <input className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Vendor name*" value={vendorForm.name} onChange={(e) => setVendorForm((f) => ({ ...f, name: e.target.value }))} />
              <input className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Service type (e.g. Equipment Repair)" value={vendorForm.service_type} onChange={(e) => setVendorForm((f) => ({ ...f, service_type: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <input className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Email" value={vendorForm.contact_email} onChange={(e) => setVendorForm((f) => ({ ...f, contact_email: e.target.value }))} />
                <input className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" placeholder="Phone" value={vendorForm.contact_phone} onChange={(e) => setVendorForm((f) => ({ ...f, contact_phone: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddVendor} disabled={saving || !vendorForm.name.trim()} className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">{saving ? "Adding…" : "Add"}</button>
                <button onClick={() => { setShowVendorForm(false); setVendorForm({ name: "", service_type: "", contact_email: "", contact_phone: "" }); }} className="text-xs text-slate-400 px-2 py-1.5">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowVendorForm(true)} className="w-full text-sm text-slate-400 hover:text-green-600 border border-dashed border-slate-200 hover:border-green-400 rounded-xl py-3 transition-colors">+ Add vendor</button>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={handleContinue} disabled={submitting || loading} className="flex-1 bg-green-600 text-white text-sm font-semibold py-3 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors">
          {submitting ? "Saving…" : vendors.length === 0 ? "Skip vendors — Continue →" : "Continue →"}
        </button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Employee Setup (now step 3)
// ═══════════════════════════════════════════════════════════════════════════════

function Step5Team({
  session,
  onNext,
}: {
  session: OnboardingSession;
  onNext: (updated: OnboardingSession) => void;
}) {
  const [source, setSource] = useState<string | null>(session.employee_source ?? null);
  const [employees, setEmployees] = useState<OnboardingEmployee[]>([]);
  const [roleMappings, setRoleMappings] = useState<RoleMapping[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [locations, setLocations] = useState<OnboardingLocation[]>([]);
  const [manualForm, setManualForm] = useState<Omit<OnboardingEmployee, "id" | "status">>({
    full_name: "",
    email: "",
    phone: "",
    position: "",
    retail_role: "staff",
    location_name: "",
    reports_to: "",
  });

  useEffect(() => {
    svc.listLocations(session.session_id).then(setLocations).catch(() => {});
  }, [session.session_id]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (source && source !== "invite_link") {
      svc.listEmployees(session.session_id)
        .then((r) => setEmployees(r.employees ?? []))
        .catch(() => {});
      if (source === "csv") {
        svc.getRoleMappings(session.session_id)
          .then((m) => setRoleMappings(m))
          .catch(() => {});
      }
    }
  }, [source, session.session_id]);

  const pickSource = async (s: string) => {
    setLoading(true);
    setError("");
    try {
      await svc.setEmployeeSource(session.session_id, s);
      setSource(s);
      if (s === "invite_link") {
        const result = await svc.generateInviteLink(session.session_id);
        setInviteLink(result.invite_url);
        setQrCode(result.qr_code_data);
      }
    } catch {
      setError("Failed to set employee method.");
    } finally {
      setLoading(false);
    }
  };

  const handleCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      await apiFetch(
        `/api/v1/onboarding/sessions/${session.session_id}/upload-employees`,
        { method: "POST", body: formData, rawBody: true }
      );
      const [emps, maps] = await Promise.all([
        svc.listEmployees(session.session_id),
        svc.getRoleMappings(session.session_id),
      ]);
      setEmployees(emps.employees ?? []);
      setRoleMappings(maps);
    } catch (err: any) {
      setError(`Failed to import CSV: ${(err as Error)?.message || "Unknown error"}`);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addEmployee = async () => {
    if (!manualForm.full_name || !manualForm.email) return;
    setLoading(true);
    try {
      await svc.addEmployee(session.session_id, manualForm);
      const r = await svc.listEmployees(session.session_id);
      setEmployees(r.employees ?? []);
      setManualForm({ full_name: "", email: "", phone: "", position: "", retail_role: "staff", location_name: "", reports_to: "" });
    } catch {
      setError("Failed to add employee.");
    } finally {
      setLoading(false);
    }
  };

  const removeEmployee = async (id: string) => {
    try {
      await svc.deleteEmployee(session.session_id, id);
      setEmployees((prev) => prev.filter((e) => e.id !== id));
    } catch {
      setError("Failed to remove employee.");
    }
  };

  const confirmStep = async () => {
    setSubmitting(true);
    setError("");
    try {
      const updated = await svc.confirmEmployees(session.session_id);
      onNext(updated);
    } catch {
      setError("Failed to proceed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Source picker
  if (!source) {
    return (
      <div>
        <StepHeader
          step={3}
          title="Set up your team"
          subtitle="Choose how you'd like to add your employees to the workspace."
        />
        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          {EMPLOYEE_SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => !s.disabled && pickSource(s.id)}
              disabled={s.disabled || loading}
              className={clsx(
                "p-5 rounded-2xl border-2 text-left transition-all",
                s.disabled
                  ? "border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed"
                  : "border-slate-200 bg-white hover:border-green-400 hover:shadow-md cursor-pointer"
              )}
            >
              <div className="text-3xl mb-2">{s.icon}</div>
              <div className="text-sm font-semibold text-slate-800">{s.label}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.desc}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <StepHeader
        step={3}
        title={source === "invite_link" ? "Invite your team" : source === "csv" ? "Import from CSV" : "Add employees manually"}
        subtitle={
          source === "invite_link"
            ? "Share the link or QR code — staff can join when ready."
            : source === "csv"
            ? "Upload a spreadsheet — we'll map roles automatically."
            : "Enter each employee one at a time."
        }
      />

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {/* Invite Link */}
      {source === "invite_link" && inviteLink && (
        <Card className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Invite URL</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteLink}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50"
              />
              <button
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-200"
              >
                Copy
              </button>
            </div>
          </div>
          {qrCode && (
            <div className="flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/svg+xml;base64,${qrCode}`} alt="QR Code" className="w-40 h-40" />
              <p className="text-xs text-slate-400 mt-2">Scan to join</p>
            </div>
          )}
        </Card>
      )}

      {/* CSV Upload */}
      {source === "csv" && (
        <Card className="p-6 mb-4">
          <input type="file" accept=".csv" ref={fileRef} onChange={handleCSV} className="hidden" />

          {/* Download template */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-slate-500 font-medium">Required: <code className="bg-slate-100 px-1 rounded">full_name, email, role</code>&nbsp; Optional: <code className="bg-slate-100 px-1 rounded">phone_number, position, work_location, reports_to</code></p>
            <button
              type="button"
              onClick={() => {
                const hint = "# role options: staff | manager | admin | super_admin";
                const header = "full_name,email,role,phone_number,position,work_location,reports_to";
                const example1 = "Juan dela Cruz,juan@example.com,staff,+63 917 000 0001,Barista,Makati Branch,Maria Santos";
                const example2 = "Maria Santos,maria@example.com,manager,,Store Manager,Makati Branch,";
                const csv = [hint, header, example1, example2].join("\n");
                const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                const a = document.createElement("a");
                a.href = url; a.download = "employees_template.csv"; a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors flex-shrink-0"
            >
              ⬇ Template
            </button>
          </div>

          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-green-400 transition-colors"
          >
            {loading ? (
              <div className="flex flex-col items-center gap-2">
                <Spinner size={24} />
                <p className="text-sm text-slate-500">Processing CSV…</p>
              </div>
            ) : (
              <>
                <p className="text-2xl mb-2">📤</p>
                <p className="text-sm font-medium text-slate-700">Click to upload CSV</p>
                <p className="text-xs text-slate-400 mt-1">or drag and drop your spreadsheet here</p>
              </>
            )}
          </div>

          {roleMappings.length > 0 && (
            <div className="mt-4">
              <h4 className="text-xs font-semibold text-slate-600 mb-2">AI Role Mapping</h4>
              <div className="space-y-2">
                {roleMappings.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 text-slate-700">{m.source_title}</span>
                    <span className="text-slate-400">→</span>
                    <select
                      value={m.retail_role}
                      onChange={async (e) => {
                        const newRole = e.target.value;
                        setRoleMappings((prev) =>
                          prev.map((r) => (r.id === m.id ? { ...r, retail_role: newRole } : r))
                        );
                        // Persist — no dedicated update fn, handled on confirm
                      }}
                      className="border border-slate-200 rounded px-2 py-1 text-xs"
                    >
                      {["staff", "manager", "admin", "super_admin"].map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                    {m.low_confidence && (
                      <span className="text-amber-500 text-xs">⚠️ Review</span>
                    )}
                    <span className="text-xs text-slate-400">×{m.employee_count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Manual Add */}
      {source === "manual" && (
        <Card className="p-5 mb-4">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Full name *</label>
              <input
                value={manualForm.full_name}
                onChange={(e) => setManualForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder="Jane Smith"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Email *</label>
              <input
                type="email"
                value={manualForm.email}
                onChange={(e) => setManualForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jane@company.com"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Position</label>
              <input
                value={manualForm.position}
                onChange={(e) => setManualForm((f) => ({ ...f, position: e.target.value }))}
                placeholder="e.g. Barista"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Role</label>
              <select
                value={manualForm.retail_role}
                onChange={(e) => setManualForm((f) => ({ ...f, retail_role: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {["staff", "manager", "admin"].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">Work location</label>
              <select
                value={manualForm.location_name ?? ""}
                onChange={(e) => setManualForm((f) => ({ ...f, location_name: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">— Select location —</option>
                {locations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-slate-600 block mb-1">Reports to (name or email)</label>
              <input
                value={manualForm.reports_to ?? ""}
                onChange={(e) => setManualForm((f) => ({ ...f, reports_to: e.target.value }))}
                placeholder="e.g. Maria Santos"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <button
            onClick={addEmployee}
            disabled={loading || !manualForm.full_name || !manualForm.email}
            className="w-full py-2 bg-slate-800 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size={14} /> : "+ Add employee"}
          </button>
        </Card>
      )}

      {/* Employee list */}
      {employees.length > 0 && (
        <Card className="mb-4">
          <div className="p-3 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-600">{employees.length} employees added</span>
          </div>
          <div className="divide-y divide-slate-50 max-h-64 overflow-y-auto">
            {employees.map((emp, i) => (
              <div key={emp.id ?? i} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-7 h-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {emp.full_name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{emp.full_name}</div>
                  <div className="text-xs text-slate-400 truncate">{emp.email}</div>
                </div>
                <span className="text-xs text-slate-400 capitalize">{emp.retail_role}</span>
                {emp.id && (
                  <button
                    onClick={() => removeEmployee(emp.id!)}
                    className="text-slate-300 hover:text-red-400 text-sm"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex gap-3 mt-4">
        <button
          onClick={() => { setSource(null); setEmployees([]); setInviteLink(null); }}
          className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm"
        >
          Change method
        </button>
        <button
          onClick={confirmStep}
          disabled={submitting || (source !== "invite_link" && employees.length === 0)}
          className="flex-1 px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting ? <Spinner size={16} /> : "Continue →"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Shift Settings
// ═══════════════════════════════════════════════════════════════════════════════

function Step6ShiftSettings({
  session,
  onNext,
}: {
  session: OnboardingSession;
  onNext: (updated: OnboardingSession) => void;
}) {
  const [form, setForm] = useState({
    late_threshold_mins: 5,
    early_departure_threshold_mins: 10,
    overtime_threshold_hours: 8,
    weekly_overtime_threshold_hours: 40,
    break_duration_mins: 30,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getAttendanceRules()
      .then((r) => {
        setForm({
          late_threshold_mins: r.late_threshold_mins,
          early_departure_threshold_mins: r.early_departure_threshold_mins,
          overtime_threshold_hours: r.overtime_threshold_hours,
          weekly_overtime_threshold_hours: r.weekly_overtime_threshold_hours,
          break_duration_mins: r.break_duration_mins,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAdvance = async (saveRules: boolean) => {
    setSaving(true);
    setError("");
    try {
      if (saveRules) await updateAttendanceRules(form);
      const updated = await svc.confirmShiftSettings(session.session_id);
      onNext(updated);
    } catch {
      setError(saveRules ? "Failed to save shift settings. Try again." : "Failed to proceed. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const Field = ({
    label,
    hint,
    field,
    unit,
    min,
    step: stepVal = 1,
  }: {
    label: string;
    hint: string;
    field: keyof typeof form;
    unit: string;
    min?: number;
    step?: number;
  }) => (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex-1">
        <div className="text-sm font-medium text-slate-800">{label}</div>
        <div className="text-xs text-slate-400 mt-0.5">{hint}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          type="number"
          min={min ?? 0}
          step={stepVal}
          value={form[field]}
          onChange={(e) => setForm((f) => ({ ...f, [field]: Number(e.target.value) }))}
          className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <span className="text-xs text-slate-400 w-12">{unit}</span>
      </div>
    </div>
  );

  return (
    <div>
      <StepHeader
        step={6}
        title="Configure shift settings"
        subtitle="Set attendance rules for your organisation. You can change these any time in Settings."
      />

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <Card className="p-5 mb-5">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner size={24} />
          </div>
        ) : (
          <>
            <Field
              label="Late threshold"
              hint="Minutes after shift start before an arrival is marked late"
              field="late_threshold_mins"
              unit="mins"
              min={0}
            />
            <Field
              label="Early departure threshold"
              hint="Minutes before shift end that counts as leaving early"
              field="early_departure_threshold_mins"
              unit="mins"
              min={0}
            />
            <Field
              label="Daily overtime threshold"
              hint="Hours worked in a single day before overtime kicks in"
              field="overtime_threshold_hours"
              unit="hrs"
              min={1}
              step={0.5}
            />
            <Field
              label="Weekly overtime threshold"
              hint="Total hours per week before weekly overtime applies"
              field="weekly_overtime_threshold_hours"
              unit="hrs"
              min={1}
              step={0.5}
            />
            <Field
              label="Default break duration"
              hint="Standard break length automatically deducted from worked hours"
              field="break_duration_mins"
              unit="mins"
              min={0}
            />
          </>
        )}
      </Card>

      <div className="flex gap-3">
        <button
          onClick={() => handleAdvance(false)}
          disabled={saving}
          className="px-5 py-3 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium disabled:opacity-50"
        >
          Use defaults
        </button>
        <button
          onClick={() => handleAdvance(true)}
          disabled={saving || loading}
          className="flex-1 px-5 py-3 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? <><Spinner size={16} /><span>Saving…</span></> : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7 — Workspace Preview
// ═══════════════════════════════════════════════════════════════════════════════

function Step7Preview({
  session,
  onNext,
}: {
  session: OnboardingSession;
  onNext: (updated: OnboardingSession) => void;
}) {
  const [preview, setPreview] = useState<WorkspacePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [activeTab, setActiveTab] = useState("forms_and_checklists");
  const [error, setError] = useState("");

  useEffect(() => {
    svc.getWorkspacePreview(session.session_id)
      .then(setPreview)
      .catch(() => setError("Failed to load preview."))
      .finally(() => setLoading(false));
  }, [session.session_id]);

  const confirm = async () => {
    setConfirming(true);
    try {
      const updated = await svc.confirmPreview(session.session_id);
      onNext(updated);
    } catch {
      setError("Failed to confirm preview.");
    } finally {
      setConfirming(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64"><Spinner size={32} /></div>
  );

  if (!preview) return <p className="text-red-500">{error || "No preview available."}</p>;

  const s = preview.summary;
  const TABS = [
    { id: "forms_and_checklists", label: `📋 Forms & Checklists (${s.forms + s.checklists})`, items: preview.forms_and_checklists },
    { id: "issue_categories", label: `⚠️ Issue Types (${s.issue_categories})`, items: preview.issue_categories },
    { id: "workflows", label: `⚡ Workflows (${s.workflows})`, items: preview.workflows },
    { id: "training_modules", label: `🎓 Training (${s.training_modules})`, items: preview.training_modules },
    { id: "shift_templates", label: `📅 Shifts (${s.shift_templates})`, items: preview.shift_templates },
    { id: "repair_manuals", label: `🔧 Repair Manuals (${s.repair_manuals})`, items: preview.repair_manuals },
  ].filter((t) => t.items.length > 0);

  // Ensure activeTab is always a tab that exists in the filtered list
  const effectiveActiveTab = TABS.some((t) => t.id === activeTab) ? activeTab : (TABS[0]?.id ?? "");
  const activeItems = TABS.find((t) => t.id === effectiveActiveTab)?.items ?? [];

  return (
    <div>
      <StepHeader
        step={7}
        title="Preview your workspace"
        subtitle="Here's everything that will be created for you. It's all editable after launch."
      />

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      {/* Company header */}
      <Card className="p-4 mb-5 flex items-center gap-4">
        {preview.brand_color && (
          <div className="w-10 h-10 rounded-full flex-shrink-0" style={{ backgroundColor: preview.brand_color }} />
        )}
        <div>
          <div className="font-bold text-slate-900">{preview.company_name ?? "Your Workspace"}</div>
          <div className="text-xs text-slate-500">{s.total_selected} templates · {(preview.employees as { total?: number }).total ?? 0} {((preview.employees as { total?: number }).total ?? 0) === 1 ? "employee" : "employees"}</div>
        </div>
      </Card>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto mb-4 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={clsx(
              "px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              effectiveActiveTab === t.id
                ? "bg-green-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Items list */}
      <Card className="mb-5 divide-y divide-slate-50 max-h-64 overflow-y-auto">
        {activeItems.map((item, i) => (
          <div key={i} className="px-4 py-3">
            <div className="text-sm font-medium text-slate-800">{(item as Record<string, string>).name}</div>
            {(item as Record<string, string>).description && (
              <div className="text-xs text-slate-400 mt-0.5">{(item as Record<string, string>).description}</div>
            )}
          </div>
        ))}
      </Card>

      <button
        onClick={confirm}
        disabled={confirming}
        className="w-full px-5 py-3 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {confirming ? <Spinner size={16} /> : "Ready — Launch Workspace →"}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Launch
// ═══════════════════════════════════════════════════════════════════════════════

const ACTION_ICONS: Record<string, string> = {
  users: "👥",
  "clipboard-list": "📋",
  "git-branch": "⚡",
  "graduation-cap": "🎓",
  checklist: "✅",
  audit: "🔍",
  issue: "⚠",
  workflow: "🔄",
  training: "🎓",
  shift: "📅",
};

function Step7Launch({
  session,
  onComplete,
}: {
  session: OnboardingSession;
  onComplete: () => void;
}) {
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const [launched, setLaunched] = useState(false);
  const [actions, setActions] = useState<{ title: string; description: string; action_url: string; action_label: string; icon: string }[]>([]);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Prevents leaked intervals when React StrictMode double-invokes effects
  const activeRef = useRef(true);

  const _startPolling = useCallback((sessionId: string) => {
    // Always clear any pre-existing interval before creating a new one
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      // Stop if the component was unmounted or a newer poll replaced this one
      if (!activeRef.current) { clearInterval(pollRef.current!); return; }
      try {
        const p = await svc.getLaunchProgress(sessionId);
        if (!activeRef.current) return;
        setProgress(p);
        if (p.status === "completed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const r = await svc.getFirstActions(sessionId);
          if (activeRef.current) setActions(Array.isArray(r) ? r : ((r as any).actions ?? []));
        } else if (p.status === "failed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setError(p.error ?? "Launch failed. Click Retry to try again.");
        }
      } catch (pollErr: unknown) {
        // 4xx = non-retryable client error — stop immediately and surface to user
        const httpStatus = (pollErr as { status?: number })?.status;
        if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          if (activeRef.current) setError("Session unavailable. Please refresh the page to continue.");
        }
        // 5xx and network errors are transient — keep polling
      }
    }, 1200);
  }, []);

  const startLaunch = useCallback(async () => {
    if (!activeRef.current) return;
    setError("");
    try {
      await svc.launchWorkspace(session.session_id);
      if (!activeRef.current) return;
      setLaunched(true);
      _startPolling(session.session_id);
    } catch (err: unknown) {
      if (!activeRef.current) return;
      const msg = (err as { message?: string })?.message ?? "";
      if (msg.includes("already been launched") || msg.includes("in progress")) {
        // Workspace was already kicked off — check current state before polling
        setLaunched(true);
        try {
          const p = await svc.getLaunchProgress(session.session_id);
          if (!activeRef.current) return;
          setProgress(p);
          if (p.status === "completed") {
            // Already done — just load first actions, no poll needed
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const r = await svc.getFirstActions(session.session_id);
            if (activeRef.current) setActions(Array.isArray(r) ? r : ((r as any).actions ?? []));
          } else if (p.status === "failed") {
            setError(p.error ?? "Launch failed. Click Retry to try again.");
          } else {
            // Still provisioning — start the polling loop
            _startPolling(session.session_id);
          }
        } catch (checkErr: unknown) {
          // Can't reach progress endpoint — show actionable error
          const checkMsg = (checkErr as { message?: string })?.message ?? "";
          if (activeRef.current) setError(checkMsg || "Could not check launch status. Please refresh the page.");
        }
      } else {
        setError(msg || "Failed to start launch. Try again.");
      }
    }
  }, [session.session_id, _startPolling]);

  useEffect(() => {
    activeRef.current = true;
    if (session.status === "completed") {
      // Already done — just fetch first actions without re-launching
      setLaunched(true);
      setProgress({ status: "completed", progress_percent: 100, current_step: "Done", steps_completed: [], steps_remaining: [] });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      svc.getFirstActions(session.session_id).then((r) => {
        if (activeRef.current) setActions(Array.isArray(r) ? r : ((r as any).actions ?? []));
      }).catch(() => {});
    } else {
      startLaunch();
    }
    return () => {
      activeRef.current = false;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = progress?.status === "completed";

  return (
    <div>
      <StepHeader
        step={8}
        title={done ? "Your workspace is ready! 🎉" : "Launching your workspace…"}
        subtitle={
          done
            ? "Everything has been set up. Here's what to do first."
            : "This takes a few minutes. Grab a coffee ☕"
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 rounded-xl border border-red-200">
          <p className="text-red-700 text-sm">{error}</p>
          <button onClick={startLaunch} className="text-xs text-red-600 underline mt-2">Retry</button>
        </div>
      )}

      {!done && launched && (
        <Card className="p-6 mb-5">
          <div className="flex items-center gap-3 mb-4">
            <Spinner size={20} />
            <span className="text-sm text-slate-600">
              {progress?.current_step ?? "Provisioning workspace…"}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500"
              style={{ width: `${progress?.progress_percent ?? 0}%` }}
            />
          </div>
          <div className="text-xs text-slate-400 mt-1 text-right">{progress?.progress_percent ?? 0}%</div>

          {/* Completed steps */}
          {(progress?.steps_completed ?? []).length > 0 && (
            <div className="mt-4 space-y-1.5">
              {progress!.steps_completed.map((step) => (
                <div key={step} className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="text-green-500">✓</span> {step}
                </div>
              ))}
              {(progress?.steps_remaining ?? []).map((step) => (
                <div key={step} className="flex items-center gap-2 text-xs text-slate-300">
                  <span>○</span> {step}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {done && (
        <div className="space-y-3">
          {actions.map((action) => (
            <div
              key={action.action_url}
              className="p-4 flex items-start gap-4 bg-white rounded-2xl border border-surface-border hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => { window.location.href = action.action_url; }}
            >
              <div className="text-2xl">{ACTION_ICONS[action.icon] ?? "📌"}</div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-800">{action.title}</div>
                <div className="text-xs text-slate-400 mt-0.5">{action.description}</div>
              </div>
              <div className="text-xs font-medium text-green-600 whitespace-nowrap">{action.action_label} →</div>
            </div>
          ))}

          <button
            onClick={onComplete}
            className="mt-4 w-full py-3 bg-green-600 text-white rounded-xl text-sm font-bold"
          >
            Go to Dashboard →
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function OnboardingPage() {
  const router = useRouter();
  const [session, setSession] = useState<OnboardingSession | null>(null);
  const [displayStep, setDisplayStep] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Guard against React StrictMode double-invocation (mount→unmount→remount in dev).
  // useRef survives the remount so the second effect call exits immediately,
  // preventing duplicate createSession() calls that produce two active sessions.
  const sessionInitRef = useRef(false);

  useEffect(() => {
    if (sessionInitRef.current) return;
    sessionInitRef.current = true;
    (async () => {
      try {
        let s = await svc.getCurrentSession();
        if (!s) {
          s = await svc.createSession();
        }
        setSession(s);
        setDisplayStep(s.current_step);
      } catch {
        setError("Failed to start onboarding. Please refresh.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleNext = (updated: OnboardingSession) => {
    setSession(updated);
    setDisplayStep(updated.current_step);
  };

  const handleComplete = () => {
    router.push("/dashboard");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={40} />
          <p className="text-slate-400 text-sm">Setting up your onboarding…</p>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500">{error || "Session not found."}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 text-sm text-green-600 underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const step = displayStep ?? session.current_step;
  const maxReached = session.current_step;

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Logo / Brand */}
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
            <span className="text-white text-sm font-bold">S</span>
          </div>
          <span className="font-bold text-slate-800">Sprout</span>
          {step > 1 && step < 8 && (
            <button
              type="button"
              onClick={() => setDisplayStep(step - 1)}
              className="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              ← Back
            </button>
          )}
          {!(step > 1 && step < 8) && (
            <span className="ml-auto text-xs text-slate-400">Setup Wizard</span>
          )}
        </div>

        <StepBar current={step} maxReached={maxReached} onGoTo={setDisplayStep} />

        <div className="min-h-[400px]">
          {step === 1 && <Step1 session={session} onNext={handleNext} />}
          {step === 2 && <Step5Team session={session} onNext={handleNext} />}
          {step === 3 && <Step6ShiftSettings session={session} onNext={handleNext} />}
          {step === 4 && <Step4Assets session={session} onNext={handleNext} />}
          {step === 5 && <Step5Vendors session={session} onNext={handleNext} />}
          {step === 6 && <Step2 session={session} onNext={handleNext} />}
          {step === 7 && <Step7Preview session={session} onNext={handleNext} />}
          {step === 8 && <Step7Launch session={session} onComplete={handleComplete} />}
        </div>
      </div>
    </div>
  );
}
