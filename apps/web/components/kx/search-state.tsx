"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const SEARCH_DELAY_MS = 160;

interface SearchState {
  query: string;
  debouncedQuery: string;
  setQuery: (value: string) => void;
  commitQuery: (value: string) => void;
}

const SearchContext = createContext<SearchState | null>(null);

export function KxSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const term = query.trim();
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(term), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const commitQuery = useCallback((value: string) => {
    setQuery(value);
    setDebouncedQuery(value.trim());
  }, []);
  const state = useMemo(() => ({ query, debouncedQuery, setQuery, commitQuery }), [query, debouncedQuery, commitQuery]);
  return <SearchContext.Provider value={state}>{children}</SearchContext.Provider>;
}

export function useKxSearch() {
  const state = useContext(SearchContext);
  if (!state) throw new Error("Search requires the Kindred app shell");
  return state;
}
