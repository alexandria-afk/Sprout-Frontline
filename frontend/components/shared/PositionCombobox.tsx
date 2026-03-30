"use client";
import { useEffect, useRef, useState } from "react";
import { Briefcase, Plus, Loader2 } from "lucide-react";
import { listPositions } from "@/services/users";
import clsx from "clsx";

interface PositionSuggestion {
  position: string;
  count: number;
}

interface PositionComboboxProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
}

export function PositionCombobox({
  value,
  onChange,
  placeholder = "e.g. Barista, Cashier, Floor Staff",
  id,
}: PositionComboboxProps) {
  const [open, setOpen]               = useState(false);
  const [suggestions, setSuggestions] = useState<PositionSuggestion[]>([]);
  const [loading, setLoading]         = useState(false);
  const containerRef                  = useRef<HTMLDivElement>(null);

  // Fetch suggestions (debounced)
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await listPositions(value);
        setSuggestions(results);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [value, open]);

  // Outside-click close
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const exactMatch = suggestions.some(
    (s) => s.position.toLowerCase() === value.trim().toLowerCase()
  );
  const showAddRow = value.trim().length > 0 && !exactMatch;

  function select(pos: string) {
    onChange(pos);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark/30 pointer-events-none" />
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full pl-9 pr-3 py-2 border border-surface-border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sprout-purple/30 focus:border-sprout-purple transition-colors"
        />
      </div>

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-surface-border rounded-xl shadow-lg overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-sprout-purple" />
            </div>
          ) : (
            <>
              {suggestions.length > 0 && (
                <ul className="max-h-48 overflow-y-auto divide-y divide-surface-border">
                  {suggestions.map((s) => (
                    <li key={s.position}>
                      <button
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); select(s.position); }}
                        className={clsx(
                          "w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors",
                          value === s.position && "bg-sprout-purple/5 text-sprout-purple font-medium"
                        )}
                      >
                        <span className="font-medium text-dark">{s.position}</span>
                        <span className="text-xs text-dark-secondary ml-2 shrink-0">
                          {s.count} {s.count === 1 ? "staff" : "staff"}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {suggestions.length === 0 && !showAddRow && (
                <p className="px-4 py-3 text-sm text-dark-secondary text-center">
                  No positions yet — type to add the first one
                </p>
              )}

              {showAddRow && (
                <>
                  {suggestions.length > 0 && (
                    <div className="border-t border-surface-border" />
                  )}
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); select(value.trim()); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-sprout-purple hover:bg-sprout-purple/5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                    Add &ldquo;{value.trim()}&rdquo; as new position
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
