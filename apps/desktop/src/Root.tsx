// Which window am I?
//
// Every window loads the same bundle. Rust decides what each one is and what it
// was opened with (`windows.rs`), and hands that over through `window_context`
// rather than a URL — so a torn-off viewer cannot end up on a stale query
// string, and the params stay structured.

import { useEffect, useState } from "react";
import UploaderApp from "./App";
import { LibraryWindow } from "./windows/LibraryWindow";
import { ReviewWindow } from "./windows/ReviewWindow";
import { SettingsWindow } from "./windows/SettingsWindow";
import { ViewerWindow } from "./windows/ViewerWindow";
import { desktop, onWindowContext, type WindowContext } from "./lib/desktop";

/** The library window, if Rust has not answered yet or has nothing to say. */
const FALLBACK: WindowContext = { label: "main", kind: "library", params: null };

export function Root() {
  const [context, setContext] = useState<WindowContext | null>(null);

  useEffect(() => {
    let live = true;
    desktop
      .windowContext()
      .then((next) => live && setContext(next ?? FALLBACK))
      .catch(() => live && setContext(FALLBACK));
    // A singleton window that was already open is re-armed rather than
    // re-created, and its fresh params arrive this way.
    const unlisten = onWindowContext((params) =>
      setContext((current) => (current ? { ...current, params } : current)),
    );
    return () => {
      live = false;
      void unlisten.then((fn) => fn());
    };
  }, []);

  if (!context) {
    return (
      <div className="k-root">
        <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
          <span className="k-eyebrow">Loading…</span>
        </div>
      </div>
    );
  }

  // Params come from Rust as opaque JSON; each window knows its own shape.
  const params = <T,>(): T => (context.params ?? {}) as T;

  switch (context.kind) {
    case "viewer":
      return <ViewerWindow params={params<{ photoId?: string; photoIds?: string[] }>()} />;
    case "review":
      return <ReviewWindow params={params<{ category?: string; clusterId?: string }>()} />;
    case "settings":
      return <SettingsWindow params={params<Parameters<typeof SettingsWindow>[0]["params"]>()} />;
    case "uploader":
      return <UploaderApp />;
    case "library":
    default:
      return <LibraryWindow />;
  }
}
