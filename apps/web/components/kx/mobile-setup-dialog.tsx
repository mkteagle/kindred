"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Spinner } from "@/components/ui";
import { BACKEND } from "@/lib/constants";

/**
 * Mobile setup QR. Carried over unchanged from the previous topbar so the
 * redesigned user menu keeps the same admin item set.
 */
export function MobileSetupDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [backendUrl, setBackendUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    dialogRef.current?.showModal();
    fetch(`${BACKEND}/app-config`)
      .then((r) => r.json())
      .then((cfg) => {
        setBackendUrl(cfg.backend_url || window.location.origin);
        setLoaded(true);
      })
      .catch(() => {
        setBackendUrl(window.location.origin);
        setLoaded(true);
      });
  }, []);

  const configPayload = JSON.stringify({
    kindred: true,
    url: backendUrl,
    key: apiKey || undefined,
  });

  return (
    <dialog
      ref={dialogRef}
      className="confirm qr-dialog"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
    >
      <div className="confirm-body">
        <h3>Mobile setup</h3>
        <p>Scan this QR code with the Kindred iOS app to connect to your server.</p>

        <div className="qr-fields">
          <label className="qr-field">
            <span>Backend URL</span>
            <input
              type="url"
              value={backendUrl}
              onChange={(e) => setBackendUrl(e.target.value)}
              placeholder="https://api.your-domain.com"
            />
          </label>
          <label className="qr-field">
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key"
            />
          </label>
        </div>

        {backendUrl && (
          <div className="qr-code-wrap">
            <QRCodeSVG value={configPayload} size={200} bgColor="#fffdf8" fgColor="#2a201b" level="M" marginSize={2} />
          </div>
        )}

        {!loaded && <Spinner />}
      </div>
      <div className="confirm-actions">
        <button className="button ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </dialog>
  );
}
