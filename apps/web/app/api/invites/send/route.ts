import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/oauth";

const ENV_RESEND_API_KEY = process.env.RESEND_API_KEY;
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://kindredphotos.app";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Kindred Photos <noreply@kindredphotos.app>";

/**
 * Try to get the Resend API key from the backend DB first,
 * then fall back to the env var.
 */
async function getResendKey(req: NextRequest): Promise<string | null> {
  try {
    const session = getSessionFromRequest(req);
    const headers: Record<string, string> = {};
    if (session?.session_token) {
      headers["X-Session-Token"] = session.session_token;
    }
    const apiKey = process.env.API_KEY;
    if (apiKey) headers["X-API-Key"] = apiKey;

    const resp = await fetch(`${BACKEND_URL}/settings/integrations/resend`, { headers });
    if (resp.ok) {
      const data = await resp.json();
      if (data.configured) {
        // The backend stores the full key but only returns a preview on GET.
        // We need the actual key, so we read it from a special internal header
        // or we simply return null and let the backend handle sending.
        // Actually, the key is in the DB — the web route should delegate sending
        // to the backend's /invites/send-email endpoint when DB key is available.
        return "__db_configured__";
      }
    }
  } catch {
    // Backend unreachable — fall through to env var
  }
  return ENV_RESEND_API_KEY || null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, invite_code, inviter_name, household_name } = body;

  if (!email || !invite_code) {
    return NextResponse.json({ error: "email and invite_code are required" }, { status: 400 });
  }

  const resendKey = await getResendKey(req);

  // If Resend is not configured anywhere, return a helpful message
  if (!resendKey) {
    return NextResponse.json(
      {
        sent: false,
        reason: "Email not configured. Add your Resend API key under Settings > Integrations, or set RESEND_API_KEY in your environment.",
        invite_link: null,
      },
      { status: 200 }
    );
  }

  // If the key is stored in the DB, the backend handles sending directly
  // via POST /invites/send-email — this route is for the env-var fallback path
  const apiKeyToUse = resendKey === "__db_configured__" ? null : resendKey;

  if (!apiKeyToUse) {
    // DB-configured: the frontend should use /api/backend/invites/send-email instead
    return NextResponse.json(
      {
        sent: false,
        reason: "Resend is configured in the database. Use the /api/backend/invites/send-email endpoint instead.",
        use_backend: true,
        invite_link: `${APP_URL}/join/${invite_code}`,
      },
      { status: 200 }
    );
  }

  const joinUrl = `${APP_URL}/join/${invite_code}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKeyToUse}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: `${inviter_name || "Someone"} invited you to ${household_name || "their Kindred Photos"} library`,
        html: buildInviteEmail({
          inviterName: inviter_name || "A family member",
          householdName: household_name || "their family",
          joinUrl,
          inviteCode: invite_code,
        }),
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ sent: false, error: err }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ sent: true, id: data.id, invite_link: joinUrl });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ sent: false, error: message }, { status: 500 });
  }
}

function buildInviteEmail(opts: {
  inviterName: string;
  householdName: string;
  joinUrl: string;
  inviteCode: string;
}) {
  const appUrl = APP_URL;
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#fbf4e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fbf4e7;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#fffdf8;border-radius:12px;border:1px solid rgba(74,40,26,.12);overflow:hidden;">
          <!-- Wordmark -->
          <tr>
            <td style="padding:28px 36px 0;text-align:center;">
              <img src="${appUrl}/kindred-wordmark.png" alt="Kindred Photos" width="140" style="display:inline-block;" />
            </td>
          </tr>
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#2a201b,#3a2818);padding:32px 36px;">
              <p style="font-family:monospace;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#e9b85d;margin:0 0 8px;">You're invited</p>
              <h1 style="font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700;color:#fbf4e7;margin:0;line-height:1.1;">${opts.inviterName} opened the ${opts.householdName} archive to you.</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px 36px;">
              <p style="font-size:15px;line-height:1.6;color:#6d3c24;margin:0 0 20px;">
                You've been invited to join a family photo library on <strong>Kindred Photos</strong>.
                Once you join, you'll see photos organized by people, places, and moments &mdash; all
                powered by AI, all stored on the family's own Flickr account.
              </p>
              <p style="font-size:15px;line-height:1.6;color:#6d3c24;margin:0 0 28px;">
                Click below to set up your account. It takes about 30 seconds.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <a href="${opts.joinUrl}" style="display:inline-block;background:#c9551c;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none;padding:14px 32px;border-radius:8px;">
                      Join the library
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Invite code fallback -->
              <p style="font-size:12px;line-height:1.6;color:#946f5b;margin:24px 0 0;text-align:center;">
                Or enter this code manually: <strong style="font-family:monospace;letter-spacing:0.1em;color:#2a201b;">${opts.inviteCode}</strong>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 36px;border-top:1px solid rgba(74,40,26,.08);">
              <p style="font-family:monospace;font-size:10px;color:#946f5b;margin:0;text-align:center;">
                Kindred Photos &middot; A product of Kindling Signal &middot; <a href="${appUrl}" style="color:#946f5b;">kindredphotos.app</a><br>
                This invite expires in 7 days.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
