import { create } from "zustand";
import type { FormTemplate } from "@/types";
import { listTemplates } from "@/services/forms";

interface FormState {
  templates: FormTemplate[];
  total: number;
  loading: boolean;
  error: string | null;
  typeFilter: string;
  fetchTemplates: (typeOverride?: string) => Promise<void>;
  addTemplate: (t: FormTemplate) => void;
  removeTemplate: (id: string) => void;
  setTypeFilter: (type: string) => void;
}

export const useFormStore = create<FormState>((set, get) => ({
  templates: [],
  total: 0,
  loading: false,
  error: null,
  typeFilter: "",

  fetchTemplates: async (typeOverride?: string) => {
    set({ loading: true, error: null });
    try {
      const type = typeOverride !== undefined ? typeOverride : get().typeFilter;
      const result = await listTemplates({
        type: type || undefined,
        page: 1,
        page_size: 200,
      });
      set({ templates: result.items, total: result.total_count, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  addTemplate: (t) => {
    set((state) => ({
      templates: [t, ...state.templates],
      total: state.total + 1,
    }));
  },

  removeTemplate: (id) => {
    set((state) => ({
      templates: state.templates.filter((t) => t.id !== id),
      total: state.total - 1,
    }));
  },

  setTypeFilter: (type) => {
    set({ typeFilter: type });
    get().fetchTemplates(type);
  },
}));
