"use client";

import Link from "next/link";
import { DEMO_USER, DEMO_HOUSEHOLD, DEMO_STATS } from "../demo-data";

const fmt = new Intl.NumberFormat();

export default function DemoSettingsPage() {
  return (
    <div className="settings-page">
      {/* Profile section */}
      <div className="settings-profile">
        <div className="settings-profile-avatar">
          <div
            className="settings-profile-initials"
            style={{ background: "linear-gradient(135deg, #2f4a36, #4a6b4f)" }}
          >
            {DEMO_USER.display_name.charAt(0).toUpperCase()}
          </div>
          <div className="settings-profile-avatar-overlay">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
        </div>
        <div className="settings-profile-info">
          <h2>{DEMO_USER.display_name}</h2>
          <span>@{DEMO_USER.username} &middot; {DEMO_USER.role}</span>
        </div>
      </div>

      {/* Household Members */}
      <section className="settings-section">
        <div className="settings-header">
          <h2>
            Household Members
            <span className="settings-count">{DEMO_HOUSEHOLD.length}</span>
          </h2>
        </div>
        <div className="settings-list">
          {DEMO_HOUSEHOLD.map((user) => (
            <div key={user.id} className="settings-row">
              <div
                className="settings-avatar"
                style={{
                  background: user.role === "admin"
                    ? "linear-gradient(135deg, #c9551c, #e9b85d)"
                    : "linear-gradient(135deg, #2f4a36, #4a6b4f)",
                }}
              >
                {user.display_name.charAt(0).toUpperCase()}
              </div>
              <div className="settings-info">
                <strong>{user.display_name}</strong>
                <span>@{user.username} &middot; {user.role} &middot; Joined {user.created_at}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Invite links */}
      <section className="settings-section">
        <div className="settings-header">
          <h2>Invite Links</h2>
        </div>
        <div className="settings-list">
          <div className="settings-row">
            <div className="settings-info">
              <strong className="settings-code">ABCD-1234</strong>
              <span>Expires Jan 30, 2026 &middot; member role</span>
            </div>
            <button className="settings-copy" onClick={() => {}}>Copy link</button>
          </div>
        </div>
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--mist)" }}>
          In the real app, you can create invite links to add household members.
        </p>
      </section>

      {/* Library Stats */}
      <section className="settings-section">
        <div className="settings-header">
          <h2>Library Stats</h2>
        </div>
        <div className="settings-list">
          <div className="settings-row">
            <div className="settings-info">
              <strong>People</strong>
              <span>{fmt.format(DEMO_STATS.people.groups)} groups &middot; {fmt.format(DEMO_STATS.people.detections)} detections</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-info">
              <strong>Animals</strong>
              <span>{fmt.format(DEMO_STATS.pets.groups)} groups &middot; {fmt.format(DEMO_STATS.pets.detections)} detections</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-info">
              <strong>Vehicles</strong>
              <span>{fmt.format(DEMO_STATS.vehicles.groups)} groups &middot; {fmt.format(DEMO_STATS.vehicles.detections)} detections</span>
            </div>
          </div>
        </div>
      </section>

      {/* API Keys placeholder */}
      <section className="settings-section">
        <div className="settings-header">
          <h2>API Keys</h2>
        </div>
        <p style={{ fontSize: 13, color: "var(--mist)" }}>
          API keys are only available in the authenticated app. Sign in to generate keys for the iOS app or backend integrations.
        </p>
      </section>

      {/* Demo notice */}
      <section style={{
        marginTop: 32,
        padding: "24px",
        borderRadius: 10,
        border: "1px dashed rgba(74, 40, 26, .2)",
        background: "rgba(255, 253, 248, .72)",
        textAlign: "center",
      }}>
        <p style={{ margin: "0 0 12px", color: "var(--ash)", fontWeight: 600, fontSize: 15 }}>
          This is a demo version of the settings page
        </p>
        <p style={{ margin: "0 0 16px", color: "var(--mist)", fontSize: 13 }}>
          Changes are not saved. Sign in to manage your real account settings.
        </p>
        <Link href="/login" className="button primary" style={{ textDecoration: "none" }}>
          Sign in
        </Link>
      </section>

      <footer className="kindling-footer">
        <span>By Kindling Signal</span>
        <p>Kindling builds useful software with character.</p>
      </footer>
    </div>
  );
}
