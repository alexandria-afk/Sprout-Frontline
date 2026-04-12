import { apiFetch } from "./api/client";

export interface ChatRoom {
  id: string;
  location_id: string;
  location_name: string;
  last_message: string | null;
  last_message_sender_id: string | null;
  last_message_sender_name: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface ChatMessage {
  id: string;
  chat_id: string;
  sender_id: string;
  sender_name: string;
  sender_avatar: string | null;
  body: string;
  media_url: string | null;
  media_type: "image" | "video" | null;
  is_deleted: boolean;
  created_at: string;
}

export async function listMyChats(): Promise<ChatRoom[]> {
  const res = await apiFetch<{ chats: ChatRoom[] }>("/api/v1/chat/my");
  return res.chats ?? [];
}

export async function getUnreadTotal(): Promise<number> {
  const res = await apiFetch<{ total_unread: number }>("/api/v1/chat/unread-total");
  return res.total_unread ?? 0;
}

export async function listMessages(
  chatId: string,
  opts: { before?: string; after?: string; limit?: number } = {}
): Promise<ChatMessage[]> {
  const params = new URLSearchParams();
  if (opts.before) params.set("before", opts.before);
  if (opts.after)  params.set("after",  opts.after);
  if (opts.limit)  params.set("limit",  String(opts.limit));
  const qs = params.toString();
  const res = await apiFetch<{ messages: ChatMessage[] }>(
    `/api/v1/chat/${chatId}/messages${qs ? `?${qs}` : ""}`
  );
  return res.messages ?? [];
}

export async function sendMessage(
  chatId: string,
  body: string,
  media_url?: string,
  media_type?: "image" | "video"
): Promise<ChatMessage> {
  return apiFetch<ChatMessage>(`/api/v1/chat/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, media_url, media_type }),
  });
}

export async function uploadMedia(
  chatId: string,
  file: File
): Promise<{ media_url: string; media_type: "image" | "video" }> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch(`/api/v1/chat/${chatId}/media`, { method: "POST", body: form });
}

export async function deleteMessage(messageId: string): Promise<void> {
  await apiFetch(`/api/v1/chat/messages/${messageId}`, { method: "DELETE" });
}
