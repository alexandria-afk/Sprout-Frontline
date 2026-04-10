"use client";

import { useEffect, useState } from "react";

export interface CurrentUser {
  id: string;
  email: string;
  role: string;
  app_metadata: {
    role: string;
    organisation_id: string | null;
    location_id: string | null;
    full_name: string;
  };
}

let _cached: CurrentUser | null = null;
let _fetching: Promise<CurrentUser | null> | null = null;

async function fetchCurrentUser(): Promise<CurrentUser | null> {
  if (_cached) return _cached;
  if (_fetching) return _fetching;
  _fetching = fetch("/api/auth/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((data: CurrentUser | null) => {
      _cached = data;
      _fetching = null;
      return data;
    })
    .catch(() => {
      _fetching = null;
      return null;
    });
  return _fetching;
}

/**
 * React hook that returns the current authenticated user.
 * Replaces `supabase.auth.getSession()` calls in client components.
 *
 * Returns the same shape as `user.app_metadata` previously provided by Supabase:
 *   { id, email, role, app_metadata: { role, organisation_id, location_id, full_name } }
 */
export function useCurrentUser() {
  const [user, setUser] = useState<CurrentUser | null>(_cached);
  const [loading, setLoading] = useState(!_cached);

  useEffect(() => {
    if (_cached) {
      setUser(_cached);
      setLoading(false);
      return;
    }
    fetchCurrentUser().then((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  return { user, loading };
}

/** Invalidate the in-memory cache (call on sign-out). */
export function invalidateCurrentUser() {
  _cached = null;
  _fetching = null;
}
