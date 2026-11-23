"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { AvatarEditor } from "@/components/avatar-editor";
import { BACKEND } from "@/lib/constants";
import { useUser } from "@/lib/use-user";

export default function AccountSettingsPage() {
  const { user, isLoading } = useUser();
  const [editing, setEditing] = useState(false);
  const queryClient = useQueryClient();
  const name = user?.display_name || user?.fullname || user?.username || "Account";
  const avatarUrl = user?.avatar_url ?? null;

  return <>
    <h2 className="kx-setting-title">Account</h2>
    {isLoading && <p role="status">Loading your profile…</p>}
    {user && <div className="kx-profilecard">
      <span className="kx-avatar xl">
        {avatarUrl ? <img src={`${BACKEND}${avatarUrl}`} alt="" /> : name.charAt(0).toUpperCase()}
      </span>
      <span className="kx-profilecard-name"><strong>{name}</strong><span>@{user.username}</span></span>
      <button className="kx-button" onClick={() => setEditing(true)}>Edit profile</button>
    </div>}
    <Link href="/settings/integrations#sign-in" className="kx-setting-row">Sign-in methods <span aria-hidden="true">›</span></Link>
    <Link href="/settings/account" className="kx-setting-row">Manage account <span aria-hidden="true">›</span></Link>
    {editing && <AvatarEditor
      currentAvatarUrl={avatarUrl}
      displayName={name}
      onSaved={(avatar_url) => {
        if (user) queryClient.setQueryData(["auth-me"], { ...user, avatar_url });
      }}
      onClose={() => setEditing(false)}
    />}
  </>;
}
