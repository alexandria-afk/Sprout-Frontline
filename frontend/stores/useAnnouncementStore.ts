import { create } from "zustand";
import type { Announcement } from "@/types";
import { listAnnouncements } from "@/services/announcements";

interface AnnouncementState {
  announcements: Announcement[];
  total: number;
  loading: boolean;
  error: string | null;
  fetchAnnouncements: () => Promise<void>;
  addAnnouncement: (a: Announcement) => void;
  removeAnnouncement: (id: string) => void;
}

export const useAnnouncementStore = create<AnnouncementState>((set) => ({
  announcements: [],
  total: 0,
  loading: false,
  error: null,

  fetchAnnouncements: async () => {
    set({ loading: true, error: null });
    try {
      const result = await listAnnouncements({ page: 1 });
      set({ announcements: result.items, total: result.total_count, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  addAnnouncement: (a) => {
    set((state) => ({
      announcements: [a, ...state.announcements],
      total: state.total + 1,
    }));
  },

  removeAnnouncement: (id) => {
    set((state) => ({
      announcements: state.announcements.filter((a) => a.id !== id),
      total: state.total - 1,
    }));
  },
}));
