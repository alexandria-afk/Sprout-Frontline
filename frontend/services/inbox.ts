import { apiFetch } from "@/services/api/client";

export type InboxItemKind = "task" | "form" | "workflow" | "course" | "announcement" | "issue";

export interface InboxItem {
  kind: InboxItemKind;
  id: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  form_type?: string | null;
  workflow_instance_id?: string | null;
  is_mandatory?: boolean;
  due_at?: string | null;
  is_overdue: boolean;
  created_at: string;
}

export function getInboxItems(): Promise<{ items: InboxItem[]; total: number }> {
  return apiFetch("/api/v1/inbox");
}
