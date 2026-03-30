"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Sparkles, X, Send, Loader2, ChevronDown, RotateCcw } from "lucide-react";
import { apiFetch } from "@/services/api/client";

type Role = "user" | "assistant";

interface Message {
  role: Role;
  content: string;
}

async function sendChat(messages: Message[]): Promise<string> {
  const res = await apiFetch<{ reply: string }>("/api/v1/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  return res.reply;
}

const WELCOME: Message = {
  role: "assistant",
  content: "Hey! I'm **Sidekick** 👋 I can help you navigate Sprout, answer ops questions, or look up how features work. What's on your mind?",
};

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={clsx("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-sprout-purple/10 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles className="w-3.5 h-3.5 text-sprout-purple" />
        </div>
      )}
      <div
        className={clsx(
          "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-sprout-purple text-white rounded-tr-sm"
            : "bg-gray-100 text-gray-800 rounded-tl-sm"
        )}
      >
        {/* Render basic markdown: **bold** and line breaks */}
        {msg.content.split("\n").map((line, i) => {
          const parts = line.split(/(\*\*[^*]+\*\*)/g);
          return (
            <p key={i} className={i > 0 ? "mt-1" : ""}>
              {parts.map((part, j) =>
                part.startsWith("**") && part.endsWith("**")
                  ? <strong key={j}>{part.slice(2, -2)}</strong>
                  : part
              )}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export function SidekickChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError("");
    setLoading(true);

    try {
      // Only send the conversation (exclude the static welcome if it's the only prior message)
      const history = next.filter((_, i) => !(i === 0 && next[0] === WELCOME));
      const reply = await sendChat(history.length ? history : next);
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setError((e as Error).message || "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function reset() {
    setMessages([WELCOME]);
    setInput("");
    setError("");
  }

  return (
    <>
      {/* Chat panel */}
      <div
        className={clsx(
          "fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50 flex flex-col",
          "w-[calc(100vw-2rem)] max-w-sm",
          "bg-white rounded-2xl shadow-2xl border border-surface-border",
          "transition-all duration-300 ease-out origin-bottom-right",
          open
            ? "opacity-100 scale-100 pointer-events-auto"
            : "opacity-0 scale-95 pointer-events-none"
        )}
        style={{ height: "480px" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border bg-sprout-purple/5 rounded-t-2xl shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-sprout-purple/15 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-sprout-purple" />
            </div>
            <div>
              <p className="text-sm font-semibold text-dark">Sidekick</p>
              <p className="text-[10px] text-dark-secondary">AI assistant · Powered by Claude</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={reset}
              title="New conversation"
              className="p-1.5 rounded-lg text-dark/40 hover:text-dark hover:bg-gray-100 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg text-dark/40 hover:text-dark hover:bg-gray-100 transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}
          {loading && (
            <div className="flex gap-2 justify-start">
              <div className="w-7 h-7 rounded-full bg-sprout-purple/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-sprout-purple" />
              </div>
              <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
          {error && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-3 pb-3 pt-2 border-t border-surface-border shrink-0">
          <div className="flex items-end gap-2 bg-gray-50 rounded-xl border border-surface-border px-3 py-2">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything…"
              disabled={loading}
              className="flex-1 bg-transparent text-sm text-dark placeholder-dark/30 resize-none focus:outline-none leading-5 max-h-24 overflow-y-auto disabled:opacity-50"
              style={{ minHeight: "20px" }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="w-7 h-7 rounded-lg bg-sprout-purple text-white flex items-center justify-center hover:bg-sprout-purple/90 transition-colors disabled:opacity-40 shrink-0 mb-0.5"
            >
              {loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Send className="w-3.5 h-3.5" />
              }
            </button>
          </div>
          <p className="text-[10px] text-dark/25 text-center mt-1.5">Shift+Enter for new line</p>
        </div>
      </div>

      {/* FAB button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={clsx(
          "fixed bottom-20 right-4 md:bottom-6 md:right-6 z-50",
          "w-13 h-13 rounded-full shadow-lg flex items-center justify-center",
          "bg-sprout-purple text-white hover:bg-sprout-purple/90 transition-all duration-200",
          "hover:scale-105 active:scale-95",
          open && "opacity-0 pointer-events-none scale-90"
        )}
        style={{ width: "52px", height: "52px" }}
        aria-label="Open Sidekick AI chat"
      >
        <Sparkles className="w-5 h-5" />
      </button>
    </>
  );
}
