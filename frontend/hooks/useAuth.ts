"use client";

import { useEffect, useState } from "react";

interface CurrentUser {
  id: string;
  email: string;
  role: string;
}

export function useAuth() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CurrentUser | null) => {
        setUser(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function signOut() {
    window.location.href = "/api/auth/signout";
  }

  return { user, loading, signOut };
}
