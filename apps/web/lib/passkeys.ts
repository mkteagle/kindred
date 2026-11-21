"use client";

import { useEffect, useState } from "react";

export function usePasskeySupport() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    setSupported(window.isSecureContext && typeof PublicKeyCredential !== "undefined" &&
      typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function" &&
      typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function" &&
      typeof PublicKeyCredential.prototype.toJSON === "function");
  }, []);
  return supported;
}

export async function passkeyRequest<T>(action: string, body: object = {}): Promise<T> {
  const response = await fetch(`/api/auth/passkeys/${action}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "The passkey request could not be completed.");
  return data;
}

export async function signInWithPasskey() {
  const { options } = await passkeyRequest<{ options: PublicKeyCredentialRequestOptionsJSON }>("login-options");
  const credential = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("No passkey was selected.");
  await passkeyRequest("login-verify", { credential: credential.toJSON() });
}

export async function addPasskey() {
  const { options } = await passkeyRequest<{ options: PublicKeyCredentialCreationOptionsJSON }>("register-options");
  const credential = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("No passkey was created.");
  await passkeyRequest("register-verify", { credential: credential.toJSON() });
}

export function passkeyError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "The passkey prompt was closed or no matching passkey was available.";
  if (error instanceof DOMException && error.name === "InvalidStateError") return "This passkey is already registered.";
  return error instanceof Error ? error.message : "The passkey request could not be completed.";
}
