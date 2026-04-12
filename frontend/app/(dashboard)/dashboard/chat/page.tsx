"use client";

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { MessageSquare, Send, ImageIcon, Trash2, X, ChevronLeft } from "lucide-react";
import { clsx } from "clsx";
import {
  listMyChats, listMessages, sendMessage, uploadMedia, deleteMessage,
  type ChatRoom, type ChatMessage,
} from "@/services/chat";
import { useTranslation } from "@/lib/i18n";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

function Avatar({ name, src, size = 32 }: { name: string; src?: string | null; size?: number }) {
  if (src) {
    return (
      <img
        src={src} alt={name}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-sprout-green/20 text-sprout-green flex items-center justify-center font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  msg, isMine, canDelete, onDelete,
}: {
  msg: ChatMessage;
  isMine: boolean;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);

  if (msg.is_deleted) {
    return (
      <div className={clsx("flex gap-2 mb-3", isMine ? "justify-end" : "justify-start")}>
        <p className="text-xs text-dark-secondary italic px-3 py-2">
          This message was deleted.
        </p>
      </div>
    );
  }

  return (
    <div
      className={clsx("flex gap-2 mb-3 group", isMine ? "flex-row-reverse" : "flex-row")}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {!isMine && (
        <Avatar name={msg.sender_name} src={msg.sender_avatar} size={30} />
      )}
      <div className={clsx("flex flex-col max-w-[72%]", isMine ? "items-end" : "items-start")}>
        {!isMine && (
          <span className="text-[11px] font-medium text-dark-secondary mb-0.5 px-1">
            {msg.sender_name}
          </span>
        )}
        <div className="relative">
          <div
            className={clsx(
              "rounded-2xl px-3 py-2 text-sm leading-relaxed",
              isMine
                ? "bg-sprout-green text-white rounded-tr-sm"
                : "bg-gray-100 text-dark rounded-tl-sm",
            )}
          >
            {msg.media_url && msg.media_type === "image" && (
              <a href={msg.media_url} target="_blank" rel="noreferrer">
                <img
                  src={msg.media_url}
                  alt="attachment"
                  className="rounded-lg max-w-[220px] max-h-[200px] object-cover mb-1.5"
                />
              </a>
            )}
            {msg.media_url && msg.media_type === "video" && (
              <video
                src={msg.media_url}
                controls
                className="rounded-lg max-w-[220px] mb-1.5"
              />
            )}
            {msg.body && <span>{msg.body}</span>}
          </div>

          {/* Delete button */}
          {canDelete && hover && (
            <button
              onClick={() => onDelete(msg.id)}
              className={clsx(
                "absolute top-1 p-1 rounded-full bg-white shadow border border-gray-200 text-red-400 hover:text-red-600 transition-colors",
                isMine ? "-left-7" : "-right-7",
              )}
              title="Delete message"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        <span className="text-[10px] text-dark-secondary mt-0.5 px-1" title={fmtFull(msg.created_at)}>
          {fmtTime(msg.created_at)}
        </span>
      </div>
    </div>
  );
}

// ── Chat room panel ────────────────────────────────────────────────────────────

function ChatPanel({
  chat, currentUserId, role, onBack,
}: {
  chat: ChatRoom;
  currentUserId: string;
  role: string;
  onBack?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [mediaPreview, setMediaPreview] = useState<{ file: File; url: string } | null>(null);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const fileRef    = useRef<HTMLInputElement>(null);
  const latestRef  = useRef<string | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  const isManagerPlus = ["manager", "admin", "super_admin"].includes(role);

  // Initial load — newest 50 messages
  useEffect(() => {
    setMessages([]);
    setHasMore(true);
    setLoadingHistory(true);
    latestRef.current = null;

    listMessages(chat.id, { limit: 50 })
      .then((msgs) => {
        // API returns newest-first; reverse to oldest-first for display
        const ordered = [...msgs].reverse();
        setMessages(ordered);
        setHasMore(msgs.length === 50);
        if (ordered.length > 0) latestRef.current = ordered[ordered.length - 1].created_at;
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [chat.id]);

  // Scroll to bottom on first load
  useEffect(() => {
    if (!loadingHistory) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [loadingHistory]);

  // Poll for new messages every 3 s
  const poll = useCallback(() => {
    if (!latestRef.current) return;
    listMessages(chat.id, { after: latestRef.current, limit: 100 })
      .then((newMsgs) => {
        if (newMsgs.length === 0) return;
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const fresh = newMsgs.filter((m) => !ids.has(m.id));
          if (fresh.length === 0) return prev;
          latestRef.current = fresh[fresh.length - 1].created_at;
          return [...prev, ...fresh];
        });
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      })
      .catch(() => {});
  }, [chat.id]);

  useEffect(() => {
    pollRef.current = setInterval(poll, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [poll]);

  // Load older messages
  async function loadMore() {
    if (!messages.length || !hasMore) return;
    const oldest = messages[0].created_at;
    const older = await listMessages(chat.id, { before: oldest, limit: 50 }).catch(() => []);
    if (older.length === 0) { setHasMore(false); return; }
    setMessages((prev) => [...[...older].reverse(), ...prev]);
    setHasMore(older.length === 50);
  }

  async function handleSend() {
    const trimmed = text.trim();
    if ((!trimmed && !mediaPreview) || sending || uploading) return;

    setSending(true);
    try {
      let media_url: string | undefined;
      let media_type: "image" | "video" | undefined;

      if (mediaPreview) {
        setUploading(true);
        const res = await uploadMedia(chat.id, mediaPreview.file);
        media_url  = res.media_url;
        media_type = res.media_type;
        setUploading(false);
        setMediaPreview(null);
      }

      const sent = await sendMessage(chat.id, trimmed, media_url, media_type);
      setMessages((prev) => [...prev, sent]);
      setText("");
      latestRef.current = sent.created_at;
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch {
      // silent — message stays in input
    } finally {
      setSending(false);
      setUploading(false);
    }
  }

  async function handleDelete(msgId: string) {
    await deleteMessage(msgId).catch(() => {});
    setMessages((prev) =>
      prev.map((m) => m.id === msgId ? { ...m, is_deleted: true } : m)
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setMediaPreview({ file, url });
    e.target.value = "";
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-border bg-white shrink-0">
        {onBack && (
          <button onClick={onBack} className="text-dark-secondary hover:text-dark mr-1">
            <ChevronLeft size={20} />
          </button>
        )}
        <div className="w-8 h-8 rounded-full bg-sprout-green/15 flex items-center justify-center">
          <MessageSquare size={15} className="text-sprout-green" />
        </div>
        <div>
          <p className="text-sm font-semibold text-dark">{chat.location_name}</p>
          <p className="text-[11px] text-dark-secondary">Team chat</p>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-sprout-green border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {hasMore && (
              <button
                onClick={loadMore}
                className="w-full text-center text-xs text-sprout-green hover:underline py-2 mb-2"
              >
                Load earlier messages
              </button>
            )}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-dark-secondary text-sm gap-2">
                <MessageSquare size={32} className="opacity-30" />
                <p>No messages yet. Say hello!</p>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isMine={msg.sender_id === currentUserId}
                canDelete={msg.sender_id === currentUserId || isManagerPlus}
                onDelete={handleDelete}
              />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Media preview */}
      {mediaPreview && (
        <div className="px-4 pb-2 flex items-center gap-2 border-t border-surface-border pt-2 bg-white shrink-0">
          <div className="relative w-16 h-16">
            <img src={mediaPreview.url} alt="preview" className="w-16 h-16 object-cover rounded-lg" />
            <button
              onClick={() => { URL.revokeObjectURL(mediaPreview.url); setMediaPreview(null); }}
              className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full border border-gray-300 flex items-center justify-center text-gray-500 hover:text-red-500"
            >
              <X size={10} />
            </button>
          </div>
          <span className="text-xs text-dark-secondary truncate">{mediaPreview.file.name}</span>
        </div>
      )}

      {/* Input bar */}
      <div className="px-4 py-3 border-t border-surface-border bg-white shrink-0 flex items-end gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          className="shrink-0 p-2 rounded-full text-dark-secondary hover:text-sprout-green hover:bg-sprout-green/10 transition-colors"
          title="Attach photo/video"
        >
          <ImageIcon size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type a message… (Enter to send)"
          maxLength={2000}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-surface-border px-3 py-2 text-sm text-dark placeholder:text-dark-secondary focus:outline-none focus:ring-2 focus:ring-sprout-green/30 max-h-32"
          style={{ lineHeight: "1.4" }}
        />
        <button
          onClick={handleSend}
          disabled={sending || uploading || (!text.trim() && !mediaPreview)}
          className="shrink-0 p-2 rounded-full bg-sprout-green text-white disabled:opacity-40 hover:bg-sprout-green/90 transition-colors"
        >
          {(sending || uploading)
            ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Send size={16} />
          }
        </button>
      </div>
    </div>
  );
}

// ── Chat list sidebar ──────────────────────────────────────────────────────────

function ChatList({
  chats, selectedId, onSelect,
}: {
  chats: ChatRoom[];
  selectedId: string | null;
  onSelect: (chat: ChatRoom) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-full border-r border-surface-border bg-white">
      <div className="px-4 py-3 border-b border-surface-border">
        <p className="text-xs font-semibold uppercase tracking-wide text-dark-secondary">
          {t("chat.teamChat")}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 && (
          <p className="text-xs text-dark-secondary px-4 py-6 text-center">
            No team chats available.
          </p>
        )}
        {chats.map((chat) => (
          <button
            key={chat.id}
            onClick={() => onSelect(chat)}
            className={clsx(
              "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-surface-border/50",
              selectedId === chat.id && "bg-sprout-green/5 border-l-2 border-l-sprout-green",
            )}
          >
            <div className="w-9 h-9 rounded-full bg-sprout-green/15 flex items-center justify-center shrink-0 mt-0.5">
              <MessageSquare size={16} className="text-sprout-green" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-semibold text-dark truncate">{chat.location_name}</span>
                <span className="text-[10px] text-dark-secondary shrink-0">
                  {chat.last_message_at ? fmtTime(chat.last_message_at) : ""}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <p className="text-xs text-dark-secondary truncate flex-1">
                  {chat.last_message
                    ? `${chat.last_message_sender_name ? chat.last_message_sender_name.split(" ")[0] + ": " : ""}${chat.last_message}`
                    : "No messages yet"}
                </p>
                {chat.unread_count > 0 && (
                  <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-sprout-green text-white text-[10px] font-bold flex items-center justify-center">
                    {chat.unread_count > 99 ? "99+" : chat.unread_count}
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

/** Inner component — uses useSearchParams, must live inside <Suspense> */
function ChatPageContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [chats, setChats]               = useState<ChatRoom[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatRoom | null>(null);
  const [loading, setLoading]           = useState(true);
  const [currentUserId, setCurrentUserId] = useState("");
  const [role, setRole]                 = useState("staff");
  const [mobileShowList, setMobileShowList] = useState(true);

  // Grab user identity via the Next.js /api/auth/me proxy
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((u) => {
        setCurrentUserId(u.id ?? u.sub ?? "");
        setRole((u.app_metadata?.role ?? u.role) || "staff");
      })
      .catch(() => {});
  }, []);

  // Load chats
  useEffect(() => {
    listMyChats()
      .then((data) => {
        setChats(data);
        // Auto-select: if ?chat_id param or staff with 1 chat
        const paramId = searchParams.get("chat_id");
        if (paramId) {
          const found = data.find((c) => c.id === paramId);
          if (found) { setSelectedChat(found); setMobileShowList(false); }
        } else if (data.length === 1) {
          setSelectedChat(data[0]);
          setMobileShowList(false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [searchParams]);

  // Refresh chat list every 30 s to keep unread counts fresh
  useEffect(() => {
    const id = setInterval(() => {
      listMyChats().then(setChats).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  function handleSelectChat(chat: ChatRoom) {
    setSelectedChat(chat);
    setMobileShowList(false);
    // Clear unread count optimistically in the list
    setChats((prev) =>
      prev.map((c) => c.id === chat.id ? { ...c, unread_count: 0 } : c)
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-6 h-6 border-2 border-sprout-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-dark-secondary">
        <MessageSquare size={40} className="opacity-30" />
        <p className="text-sm">{t("chat.noChats")}</p>
      </div>
    );
  }

  const isMultiChat = chats.length > 1;

  return (
    <div className="h-[calc(100vh-4rem)] md:h-[calc(100vh-2rem)] flex overflow-hidden rounded-xl border border-surface-border">
      {/* ── Desktop: always show list + panel side-by-side ── */}
      {isMultiChat && (
        <div className="hidden md:block w-72 shrink-0">
          <ChatList chats={chats} selectedId={selectedChat?.id ?? null} onSelect={handleSelectChat} />
        </div>
      )}

      {/* ── Desktop: message panel ── */}
      <div className="hidden md:flex flex-col flex-1 bg-white overflow-hidden">
        {selectedChat ? (
          <ChatPanel
            chat={selectedChat}
            currentUserId={currentUserId}
            role={role}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-dark-secondary">
            <MessageSquare size={40} className="opacity-20" />
            <p className="text-sm">{t("chat.selectChat")}</p>
          </div>
        )}
      </div>

      {/* ── Mobile: chat list OR message panel ── */}
      <div className="md:hidden flex flex-col flex-1 overflow-hidden">
        {mobileShowList || !selectedChat ? (
          isMultiChat ? (
            <ChatList chats={chats} selectedId={selectedChat?.id ?? null} onSelect={handleSelectChat} />
          ) : (
            // Staff with 1 chat — go straight to panel
            selectedChat && (
              <ChatPanel
                chat={selectedChat}
                currentUserId={currentUserId}
                role={role}
              />
            )
          )
        ) : (
          selectedChat && (
            <ChatPanel
              chat={selectedChat}
              currentUserId={currentUserId}
              role={role}
              onBack={isMultiChat ? () => setMobileShowList(true) : undefined}
            />
          )
        )}
      </div>
    </div>
  );
}

/** Page export — wraps inner component in Suspense (required for useSearchParams) */
export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-6 h-6 border-2 border-sprout-green border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ChatPageContent />
    </Suspense>
  );
}
