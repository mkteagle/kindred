/**
 * Notification type catalog — canonical source of truth for the web app.
 * Matches iOS catalog. No billing types (open source, no billing).
 * No email channel (user preference — push + inbox only).
 */

export type ChannelId = "push" | "inbox";
export type Frequency = "realtime" | "daily" | "weekly";
export type SectionId = "quiet_hours" | "photos" | "household" | "admin";

export interface NotifTypeDef {
  id: string;
  title: string;
  description: string;
  section: SectionId;
  pushDefault: boolean;
  inboxDefault: boolean;
  inboxLocked: boolean; // true = always on, renders "ALWAYS" pill
  frequency: Frequency;
  triggers: string;
  glyphStyle: "memory" | "together" | "sync" | "household" | "admin" | "activity" | "cover";
}

export const NOTIF_CATALOG: NotifTypeDef[] = [
  {
    id: "photos.backed_up",
    title: "New photos backed up",
    description: "Confirms sync at end of day",
    section: "photos",
    pushDefault: false,
    inboxDefault: true,
    inboxLocked: false,
    frequency: "daily",
    triggers: "Backup batch > 10 photos",
  glyphStyle: "sync",
  },
  {
    id: "photos.memory_ready",
    title: "Memory ready",
    description: "On-this-day, trips, spotlights",
    section: "photos",
    pushDefault: true,
    inboxDefault: true,
    inboxLocked: true,
    frequency: "realtime",
    triggers: "Memory builder finds 5+ photos matching theme",
    glyphStyle: "memory",
  },
  {
    id: "photos.together_found",
    title: "Together found",
    description: "2+ household members in one frame",
    section: "photos",
    pushDefault: true,
    inboxDefault: true,
    inboxLocked: false,
    frequency: "realtime",
    triggers: "Pair-clustering threshold reached",
    glyphStyle: "together",
  },
  {
    id: "photos.sync_paused",
    title: "Sync paused",
    description: "Out of Wi-Fi or storage",
    section: "photos",
    pushDefault: true,
    inboxDefault: true,
    inboxLocked: false,
    frequency: "realtime",
    triggers: "Sync stalled > 30 min",
    glyphStyle: "sync",
  },
  {
    id: "household.member_joined",
    title: "Member joined or left",
    description: "Always tell the household",
    section: "household",
    pushDefault: true,
    inboxDefault: true,
    inboxLocked: true,
    frequency: "realtime",
    triggers: "Invite accepted / member removed",
    glyphStyle: "household",
  },
  {
    id: "household.activity",
    title: "Photo activity",
    description: "Comments and hearts",
    section: "household",
    pushDefault: false,
    inboxDefault: true,
    inboxLocked: false,
    frequency: "realtime",
    triggers: "Per event, debounced 5 min/user",
    glyphStyle: "activity",
  },
  {
    id: "household.cover_updated",
    title: "Cover updated",
    description: "Person/pet cover changed",
    section: "household",
    pushDefault: false,
    inboxDefault: true,
    inboxLocked: false,
    frequency: "realtime",
    triggers: "Cover photo set",
    glyphStyle: "cover",
  },
  {
    id: "admin.storage_warning",
    title: "Storage warning",
    description: "< 10% of plan free",
    section: "admin",
    pushDefault: true,
    inboxDefault: true,
    inboxLocked: true,
    frequency: "realtime",
    triggers: "Storage % crosses 90 / 95 / 99",
    glyphStyle: "admin",
  },
  {
    id: "admin.signin_new_device",
    title: "Sign-in from new device",
    description: "Always tell the admin",
    section: "admin",
    pushDefault: true,
    inboxDefault: true,
    inboxLocked: true,
    frequency: "realtime",
    triggers: "New device fingerprint",
    glyphStyle: "admin",
  },
];

/** Section labels and ordering */
export const SECTIONS: { id: SectionId; label: string; adminOnly: boolean }[] = [
  { id: "quiet_hours", label: "Quiet hours", adminOnly: false },
  { id: "photos", label: "Photos", adminOnly: false },
  { id: "household", label: "Household", adminOnly: false },
  { id: "admin", label: "Account", adminOnly: true },
];

/** Glyph style config for rendering notification icons */
export const GLYPH_STYLES: Record<string, { bg: string; color: string; gradient?: string }> = {
  memory: { bg: "transparent", color: "#fff", gradient: "linear-gradient(135deg, var(--gold), var(--ember))" },
  together: { bg: "rgba(47,74,54,.16)", color: "var(--forest)" },
  sync: { bg: "rgba(74,40,26,.08)", color: "var(--pine)" },
  household: { bg: "rgba(201,85,28,.12)", color: "var(--ember)" },
  admin: { bg: "rgba(154,52,22,.14)", color: "var(--rosehip)" },
  activity: { bg: "rgba(47,74,54,.12)", color: "var(--forest)" },
  cover: { bg: "rgba(201,85,28,.08)", color: "var(--ember)" },
};

/** Map backend notification types to our glyph styles */
export function getGlyphStyle(type: string): string {
  if (type.includes("memory") || type === "photos.memory_ready") return "memory";
  if (type.includes("together") || type === "photos.together_found") return "together";
  if (type.includes("sync") || type.includes("backed_up") || type === "scan_complete" || type === "photo_processed") return "sync";
  if (type.includes("household") || type.includes("member")) return "household";
  if (type.includes("admin") || type.includes("storage") || type.includes("signin") || type === "photos_deleted") return "admin";
  if (type.includes("activity") || type.includes("comment") || type.includes("heart")) return "activity";
  if (type.includes("cover")) return "cover";
  return "sync";
}

/** Channel color mapping */
export const CHANNEL_COLORS = {
  push: "var(--ember)",
  inbox: "var(--forest)",
} as const;
