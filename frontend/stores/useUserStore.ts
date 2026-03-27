import { create } from "zustand";
import type { Profile } from "@/types";
import { listUsers } from "@/services/users";

interface UserState {
  users: Profile[];
  total: number;
  loading: boolean;
  error: string | null;
  page: number;
  search: string;
  role: string;
  locationId: string;
  fetchUsers: () => Promise<void>;
  setSearch: (s: string) => void;
  setPage: (n: number) => void;
  setRole: (r: string) => void;
  setLocationId: (l: string) => void;
  removeUser: (id: string) => void;
}

export const useUserStore = create<UserState>((set, get) => ({
  users: [],
  total: 0,
  loading: false,
  error: null,
  page: 1,
  search: "",
  role: "",
  locationId: "",

  fetchUsers: async () => {
    set({ loading: true, error: null });
    try {
      const { page, search, role, locationId } = get();
      const result = await listUsers({
        page,
        page_size: 20,
        search: search || undefined,
        role: role || undefined,
        location_id: locationId || undefined,
      });
      set({ users: result.items ?? [], total: result.total_count ?? 0, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  setSearch: (s) => {
    set({ search: s, page: 1 });
  },

  setPage: (n) => {
    set({ page: n });
  },

  setRole: (r) => {
    set({ role: r, page: 1 });
  },

  setLocationId: (l) => {
    set({ locationId: l, page: 1 });
  },

  removeUser: (id) => {
    set((state) => ({
      users: state.users.filter((u) => u.id !== id),
      total: state.total - 1,
    }));
  },
}));
