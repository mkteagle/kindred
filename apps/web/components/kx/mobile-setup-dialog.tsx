"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { CloseIcon, QrIcon } from "./icons";
import { PairDeviceForm } from "./pair-device-form";

export function MobileSetupDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleID = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="kx-mobile-setup"
      aria-labelledby={titleID}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <header className="kx-pair-heading">
        <span className="kx-pair-heading-icon" aria-hidden="true"><QrIcon /></span>
        <div>
          <h2 id={titleID}>Mobile setup</h2>
          <p>In Kindred on your iPhone, tap <strong>Scan a pairing code</strong> to sign in to this household.</p>
        </div>
        <button className="kx-iconbutton" aria-label="Close mobile setup" type="button" onClick={() => dialogRef.current?.close()}>
          <CloseIcon />
        </button>
      </header>
      <PairDeviceForm />
      <footer className="kx-mobile-setup-footer">
        <Link href="/docs/mobile/config" onClick={() => dialogRef.current?.close()}>Mobile setup guide</Link>
      </footer>
    </dialog>
  );
}
