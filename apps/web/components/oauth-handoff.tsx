"use client";

import { useRef, useEffect } from "react";

interface OAuthHandoffProps {
  onClose: () => void;
  onContinue: () => void;
}

/**
 * OAuth handoff explainer — shows 3 steps before redirecting to Flickr.
 * Design spec: Slide 10 from the design handoff.
 */
export function OAuthHandoff({ onClose, onContinue }: OAuthHandoffProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const handleClose = () => {
    dialogRef.current?.close();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="confirm"
      style={{
        width: "min(1100px, calc(100vw - 48px))",
        borderRadius: 14,
        border: "1px solid var(--line)",
        padding: 0,
        background: "var(--card)",
        boxShadow: "var(--shadow)",
      }}
      onClose={handleClose}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={{ padding: "36px 32px 24px" }}>
        <div style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".14em",
          textTransform: "uppercase" as const,
          color: "var(--mist)",
          marginBottom: 8,
          textAlign: "center" as const,
        }}>
          Flickr connection
        </div>
        <h3 style={{
          fontFamily: "var(--display)",
          fontSize: 28,
          fontWeight: 700,
          textAlign: "center" as const,
          margin: "0 0 32px",
          color: "var(--ash)",
        }}>
          Here&apos;s what happens next
        </h3>

        <div className="oauth-handoff">
          {/* Step 1 */}
          <div className="oauth-step-card">
            <div className="oauth-step-header">Step 1 &mdash; On Kindred</div>
            <h4>Confirm connection</h4>
            <p>
              We&apos;ll ask you to confirm that you want to connect your
              Flickr photo library to this Kindred household.
            </p>
            <div className="oauth-step-preview" style={{
              padding: 20,
              background: "var(--ash)",
              color: "var(--paper)",
              textAlign: "center" as const,
            }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                Connect your Flickr library?
              </div>
              <div style={{ fontSize: 13, opacity: .7, marginBottom: 16 }}>
                This will import your photos and albums.
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <span style={{
                  padding: "6px 16px",
                  borderRadius: 6,
                  border: "1px solid rgba(251,244,231,.26)",
                  fontSize: 12,
                  fontWeight: 700,
                }}>Cancel</span>
                <span style={{
                  padding: "6px 16px",
                  borderRadius: 6,
                  background: "var(--ember)",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                }}>Continue</span>
              </div>
            </div>
          </div>

          <span className="oauth-arrow">&rarr;</span>

          {/* Step 2 */}
          <div className="oauth-step-card">
            <div className="oauth-step-header">Step 2 &mdash; On Flickr</div>
            <h4>Authorize on Flickr</h4>
            <p>
              You&apos;ll be taken to Flickr&apos;s site to authorize
              Kindred to read your photo library. We never modify or delete photos.
            </p>
            <div className="oauth-step-preview" style={{
              padding: 20,
              background: "#fff",
              textAlign: "center" as const,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: "linear-gradient(135deg, #0063dc, #ff0084)",
                margin: "0 auto 12px",
              }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: "#222", marginBottom: 12 }}>
                Authorize Kindred Photos?
              </div>
              <span style={{
                padding: "8px 20px",
                borderRadius: 4,
                background: "#0063dc",
                color: "#fff",
                fontSize: 12,
                fontWeight: 700,
                textTransform: "uppercase" as const,
              }}>OK, I&apos;ll Authorize It</span>
            </div>
          </div>

          <span className="oauth-arrow">&rarr;</span>

          {/* Step 3 */}
          <div className="oauth-step-card">
            <div className="oauth-step-header">Step 3 &mdash; Back on Kindred</div>
            <h4>Import preview</h4>
            <p>
              Once connected, we&apos;ll show you a preview of your
              albums and photos before the import begins.
            </p>
            <div className="oauth-step-preview" style={{
              padding: 20,
              background: "var(--paper)",
              textAlign: "center" as const,
            }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
                marginBottom: 12,
              }}>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} style={{
                    height: 48,
                    borderRadius: 4,
                    background: "rgba(74,40,26,.08)",
                  }} />
                ))}
              </div>
              <div style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--mist)",
              }}>
                Found photos across albums.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{
        display: "flex",
        gap: 10,
        padding: "0 32px 28px",
        justifyContent: "center",
      }}>
        <button className="button ghost" onClick={handleClose} style={{ minWidth: 140 }}>
          Cancel
        </button>
        <button className="button primary lg" onClick={onContinue} style={{ minWidth: 220 }}>
          Continue to Flickr &rarr;
        </button>
      </div>
    </dialog>
  );
}
