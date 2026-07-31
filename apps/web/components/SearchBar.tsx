"use client";

import { useRef, useState } from "react";
import type { ZipNow } from "@/lib/types";

interface SearchBarProps {
  rows: ZipNow[];
  onSelect: (zip: string) => void;
}

export function SearchBar({ rows, onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const suggestions =
    q.length === 0
      ? []
      : rows
          .filter(
            (r) =>
              r.zip.startsWith(q) ||
              r.town.toLowerCase().includes(q),
          )
          .slice(0, 6);

  function handleSelect(zip: string) {
    onSelect(zip);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && suggestions.length > 0) {
      handleSelect(suggestions[0].zip);
    }
    if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    }
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
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder="Search your County, City, or ZIP Code"
        className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 outline-none"
        aria-label="Search ZIP codes"
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 min-w-64 rounded-md border border-gray-200 bg-white shadow-lg"
        >
          {suggestions.map((r) => (
            <li key={r.zip} role="option" aria-selected={false}>
              <button
                onMouseDown={() => handleSelect(r.zip)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50"
              >
                <span className="font-medium text-gray-800">
                  {r.zip} · {r.town}
                </span>
                <span className="ml-4 text-xs text-gray-400">AQI {r.aqi}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
