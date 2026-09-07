// Space — quick look.
//
// A peek, not the viewer: no inspector, no filmstrip, and Space closes it
// again. It draws the 2048px `preview` variant, which is the same file the
// viewer window uses, so opening one after the other is instant.

import { useEffect, useRef } from "react";
import { Kbd } from "./Chrome";
import { useMedia } from "../lib/media";

export function QuickLook({ photoId, onClose }: { photoId: string; onClose: () => void }) {
  const media = useMedia(photoId, "preview");
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusTo = useRef<Element | null>(null);

  useEffect(() => {
    restoreFocusTo.current = document.activeElement;
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      (restoreFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick look"
      className="k-rise"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        background: "rgba(8,9,8,.92)",
        display: "grid",
        gridTemplateRows: "1fr auto",
        placeItems: "center",
        padding: 32,
      }}
      onClick={onClose}
    >
      {media.src ? (
        <img
          src={media.src}
          alt=""
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            borderRadius: 3,
            boxShadow: "0 30px 80px rgba(0,0,0,.6)",
          }}
        />
      ) : (
        <p style={{ color: "var(--k-ink-4)", fontSize: 13 }}>
          {media.loading
            ? "Fetching…"
            : "Not kept offline, and the server did not answer."}
        </p>
      )}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="k-btn k-btn-quiet"
        style={{ marginTop: 16 }}
      >
        Close <Kbd>Space</Kbd>
      </button>
    </div>
  );
}
