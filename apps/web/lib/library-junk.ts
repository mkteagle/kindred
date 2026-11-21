import type { QueryClient } from "@tanstack/react-query";

export const JUNK_LABELS = {
  screenshot: "Screenshot",
  receipt: "Receipt",
  document: "Document",
  code: "Standalone code",
  blank: "Blank image",
} as const;

export type JunkReason = keyof typeof JUNK_LABELS;

export function refreshLibraryVisibility(queryClient: QueryClient) {
  for (const key of ["library-mosaic", "library-counts", "library-years", "kx-search", "kx-search-capture"]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}
