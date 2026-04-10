"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Sliders } from "lucide-react";
import { getMyOrganisation, updateOrgFeatureFlags } from "@/services/users";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { OrgFeatureFlags } from "@/services/users";

// ── Styles ────────────────────────────────────────────────────────────────────

const btnPrimary =
  "flex items-center gap-2 px-4 py-2 rounded-lg bg-sprout-purple text-white text-sm font-medium hover:bg-sprout-purple/90 transition-colors disabled:opacity-50";

// ── Banner ────────────────────────────────────────────────────────────────────

function Banner({
  type,
  message,
  onDismiss,
}: {
  type: "success" | "error";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium ${
        type === "success"
          ? "bg-green-50 text-green-800 border border-green-200"
          : "bg-red-50 text-red-800 border border-red-200"
      }`}
    >
      <span>{message}</span>
      <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
        ✕
      </button>
    </div>
  );
}

// ── Toggle Row ────────────────────────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  enabled,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-dark">{label}</p>
        <p className="text-xs text-dark-secondary mt-0.5 leading-relaxed">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sprout-purple focus-visible:ring-offset-2 disabled:opacity-50 ${
          enabled ? "bg-sprout-purple" : "bg-gray-200"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FeatureSettingsPage() {
  const { user: currentUser } = useCurrentUser();
  const [orgId, setOrgId] = useState<string>("");
  const [flags, setFlags] = useState<OrgFeatureFlags>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const id = currentUser.app_metadata?.organisation_id;
    if (id) setOrgId(id);

    getMyOrganisation()
      .then(org => {
        setFlags(org.feature_flags ?? {});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentUser]);

  async function handleSave() {
    if (!orgId) return;
    setSaving(true);
    try {
      const updated = await updateOrgFeatureFlags(orgId, flags);
      setFlags(updated.feature_flags ?? {});
      setBanner({ type: "success", msg: "Feature settings saved." });
    } catch (e) {
      setBanner({ type: "error", msg: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  function toggle(key: keyof OrgFeatureFlags) {
    setFlags(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="min-h-full bg-[#F0F2F5] -m-4 md:-m-8 -mt-[4.5rem] md:-mt-8 p-4 md:p-6 pt-[4.5rem] md:pt-8 pb-24 md:pb-8">
      <div className="flex flex-col gap-6 max-w-2xl mx-auto w-full">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="p-1.5 rounded-lg hover:bg-white/60 text-dark/50 hover:text-dark transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="w-10 h-10 rounded-xl bg-sprout-purple/10 flex items-center justify-center shrink-0">
            <Sliders className="w-5 h-5 text-sprout-purple" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-dark">Feature Settings</h1>
            <p className="text-sm text-dark-secondary">
              Enable or disable optional platform features for your organisation.
            </p>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-sprout-purple" />
          </div>
        ) : (
          <div className="space-y-4">
            {banner && (
              <Banner type={banner.type} message={banner.msg} onDismiss={() => setBanner(null)} />
            )}

            <div className="bg-white rounded-xl border border-surface-border p-6">
              <h3 className="font-semibold text-dark mb-1">Workforce Features</h3>
              <p className="text-xs text-dark-secondary mb-4">
                Controls for optional workforce management capabilities.
              </p>

              <div className="divide-y divide-surface-border">
                <ToggleRow
                  label="Staff Availability Tracking"
                  description="Allow staff to set their available days and hours. Used by AI schedule generation. When off, the Availability tab is hidden from Shifts and the AI scheduler assumes all staff are always available."
                  enabled={!!flags.staff_availability_enabled}
                  onChange={() => toggle("staff_availability_enabled")}
                  disabled={saving}
                />
              </div>

              <div className="mt-6 pt-4 border-t border-surface-border">
                <button className={btnPrimary} onClick={handleSave} disabled={saving || !orgId}>
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
