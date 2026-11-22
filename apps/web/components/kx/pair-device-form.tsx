"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { BACKEND } from "@/lib/constants";
import "./mobile-setup.css";

interface PairingCode {
  id: string;
  url: string;
  code: string;
  server_url: string;
  display_code: string;
  expires_in_seconds: number;
  browserUrl?: string;
}

interface PairingStatus {
  claimed: boolean;
  device_name: string | null;
}

function formatCountdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PairDeviceForm() {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showClassic, setShowClassic] = useState(false);

  async function createCode() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`${BACKEND}/pairing/codes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(typeof data.detail === "string" ? data.detail : "Could not create a pairing code.");
        return;
      }
      setStatus(null);
      setCopied(false);
      setShowClassic(false);
      const browserUrl = window.location.protocol === "https:"
        ? `${window.location.origin}/pair#${new URLSearchParams({ server: data.server_url, code: data.code })}`
        : undefined;
      setCode({ ...data, browserUrl });
      setRemaining(data.expires_in_seconds);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    if (!code || status?.claimed) return;
    const expiresAt = Date.now() + code.expires_in_seconds * 1000;
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [code, status?.claimed]);

  const expired = remaining === 0 && !status?.claimed;
  const codeID = code?.id;
  useEffect(() => {
    if (!codeID || status?.claimed || expired) return;
    const controller = new AbortController();
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${BACKEND}/pairing/codes/${codeID}`, { signal: controller.signal });
        if (!response.ok) return;
        const nextStatus = await response.json() as PairingStatus;
        if (nextStatus.claimed && !controller.signal.aborted) setStatus(nextStatus);
      } catch {
        // The next check can recover a dropped request.
      }
    }, 2000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [codeID, expired, status?.claimed]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyServerAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="kx-pair-form">
      {!code && (
        <div className="kx-pair-start">
          <button className="kx-button primary" type="button" onClick={() => void createCode()} disabled={creating}>
            {creating ? "Creating…" : "Create a pairing code"}
          </button>
          <p>The code expires after 10 minutes and can be used once.</p>
        </div>
      )}

      {code && status?.claimed && (
        <div className="kx-pair-done" role="status">
          <div>
            <h3>Device paired</h3>
            <p>{status.device_name ?? "Your device"} is now signed in to this household.</p>
          </div>
          <button className="kx-button" type="button" onClick={() => { setCode(null); setStatus(null); }}>
            Pair another device
          </button>
        </div>
      )}

      {code && !status?.claimed && (
        <div className="kx-pair-code-card ph-no-capture">
          <div className="kx-pair-qr">
            {expired ? (
              <span>Code expired</span>
            ) : (
              <QRCodeSVG value={showClassic ? code.url : code.browserUrl ?? code.url} size={172} level="M" marginSize={4} title="Pairing QR code" />
            )}
          </div>

          <div className="kx-pair-code-details">
            {expired ? (
              <button className="kx-button primary" type="button" onClick={() => void createCode()} disabled={creating}>
                {creating ? "Creating…" : "Create a new code"}
              </button>
            ) : (
              <>
                <p className="kx-pair-label">
                  {showClassic || !code.browserUrl ? "Scan this code in Kindred." : "Scan with your iPhone Camera or in Kindred."}
                </p>
                <div>
                  <p className="kx-pair-label">Or enter this code in the app</p>
                  <p className="kx-pair-code">{code.display_code}</p>
                </div>
                <div>
                  <p className="kx-pair-label">Server address</p>
                  <div className="kx-pair-address">
                    <code>{code.server_url}</code>
                    <button className="kx-button" type="button" onClick={() => void copyServerAddress(code.server_url)}>
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
                {code.browserUrl && (
                  <button className="kx-button" type="button" onClick={() => setShowClassic(!showClassic)}>
                    {showClassic ? "Show Camera-compatible code" : "Show code for older Kindred versions"}
                  </button>
                )}
                <p className="kx-pair-expiration">Expires in <span>{formatCountdown(remaining)}</span></p>
              </>
            )}
          </div>
        </div>
      )}

      {error && <p className="kx-pair-error" role="alert">{error}</p>}
    </div>
  );
}
