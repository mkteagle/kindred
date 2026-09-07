"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { BACKEND } from "@/lib/constants";

/**
 * Pair a phone with this household's server.
 *
 * A self-hosted instance lives at a URL only its owner knows. Rather than
 * typing that URL and a password on a touchscreen, the phone reads both from a
 * code that is valid for ten minutes and can be used once.
 */

interface PairingCode {
  id: string;
  url: string;
  server_url: string;
  code: string;
  display_code: string;
  expires_in_seconds: number;
}

interface PairingStatus {
  claimed: boolean;
  device_name: string | null;
  expires_in_seconds: number;
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function PairDevicePage() {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const createCode = useCallback(async () => {
    setCreating(true);
    setError(null);
    setStatus(null);
    stopPolling();
    try {
      const response = await fetch(`${BACKEND}/pairing/codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.detail || "Could not create a pairing code");
        return;
      }
      setCode(data);
      setRemaining(data.expires_in_seconds);
    } catch {
      setError("Could not reach the server");
    } finally {
      setCreating(false);
    }
  }, [stopPolling]);

  // Count the code down, and stop offering it once it has expired.
  useEffect(() => {
    if (!code || status?.claimed) return;
    const timer = setInterval(() => setRemaining((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [code, status?.claimed]);

  // Poll until the phone picks it up, so the page can confirm rather than
  // leaving you wondering whether the scan worked.
  useEffect(() => {
    if (!code || status?.claimed || remaining <= 0) {
      stopPolling();
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${BACKEND}/pairing/codes/${code.id}`);
        if (!response.ok) return;
        const data: PairingStatus = await response.json();
        setStatus(data);
        if (data.claimed) stopPolling();
      } catch {
        // A dropped poll is not worth surfacing; the next one will do.
      }
    }, 2000);
    return stopPolling;
  }, [code, status?.claimed, remaining, stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const expired = Boolean(code) && remaining <= 0 && !status?.claimed;

  return (
    <div className="app-shell">
      <main className="page">
        <div className="content-head">
          <div>
            <h2>Pair a device</h2>
            <p>
              Open Kindred on your phone and scan this code. It learns this
              server&rsquo;s address and signs itself in — no URL to type.
            </p>
          </div>
        </div>

        {!code && (
          <div className="pair-start">
            <button className="button primary lg" onClick={() => void createCode()} disabled={creating}>
              {creating ? "Creating…" : "Create a pairing code"}
            </button>
            <p className="pair-hint">
              The code lasts ten minutes and can be used once.
            </p>
          </div>
        )}

        {code && status?.claimed && (
          <div className="pair-done" role="status">
            <h3>Paired</h3>
            <p>
              {status.device_name ? <><strong>{status.device_name}</strong> is</> : "That device is"}{" "}
              now signed in to this household.
            </p>
            <button className="button" onClick={() => { setCode(null); setStatus(null); }}>
              Pair another device
            </button>
          </div>
        )}

        {code && !status?.claimed && (
          <div className="pair-card">
            <div className={`pair-qr ${expired ? "is-expired" : ""}`}>
              <QRCodeSVG value={code.url} size={228} level="M" marginSize={2} />
              {expired && <div className="pair-expired-overlay">Expired</div>}
            </div>

            <div className="pair-details">
              <p className="pair-label">Or type this code into the app</p>
              <p className="pair-code">{code.display_code}</p>

              <p className="pair-label">Server address</p>
              <div className="pair-server">
                <code>{code.server_url}</code>
                <button
                  className="button small ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(code.server_url);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              {expired ? (
                <button className="button primary" onClick={() => void createCode()}>
                  Create a new code
                </button>
              ) : (
                <p className="pair-countdown">
                  Expires in <strong>{formatCountdown(remaining)}</strong> · waiting for the device…
                </p>
              )}
            </div>
          </div>
        )}

        {error && <p className="share-error" role="alert">{error}</p>}
      </main>
    </div>
  );
}
