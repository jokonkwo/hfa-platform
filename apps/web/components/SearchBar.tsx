"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/lib/types";
import { fetchSearch } from "@/lib/api";

interface SearchBarProps {
  onSelect: (result: SearchResult) => void;
}

const TYPE_LABEL: Record<SearchResult["type"], string> = {
  state: "State",
  county: "County",
  zip: "ZIP",
  place: "City",
};

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback((q: string) => {
    abortRef.current?.abort();
    if (!q.trim()) { setResults([]); return; }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetchSearch(q, ctrl.signal).then((res) => {
      if (!ctrl.signal.aborted) setResults(res);
    });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch]);

  function handleSelect(result: SearchResult) {
    onSelect(result);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && results.length > 0) handleSelect(results[0]);
    if (e.key === "Escape") { setQuery(""); setResults([]); setOpen(false); inputRef.current?.blur(); }
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2 px-1">
      <svg
        className="h-4 w-4 flex-shrink-0 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path strokeLinecap="round" d="m21 21-4.35-4.35" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder="Search state, county, city, or ZIP code"
        className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 outline-none"
        aria-label="Search states, counties, cities, and ZIP codes"
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 min-w-72 rounded-md border border-gray-200 bg-white shadow-lg"
        >
          {results.map((r) => (
            <li key={`${r.type}-${r.identifier}`} role="option" aria-selected={false}>
              <button
                onMouseDown={() => handleSelect(r)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50"
              >
                <span className="font-medium text-gray-800">{r.display_name}</span>
                <span className="ml-4 flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                  {TYPE_LABEL[r.type]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
