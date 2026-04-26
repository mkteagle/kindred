import { NextRequest, NextResponse } from "next/server";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://kindredphotos.app";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Kindred Photos <noreply@kindredphotos.app>";

export async function POST(req: NextRequest) {
  // Resend is optional — if not configured, return a helpful message
  if (!RESEND_API_KEY) {
    return NextResponse.json(
      {
        sent: false,
        reason: "Email not configured. Set RESEND_API_KEY in your environment to enable invite emails.",
        invite_link: null,
      },
      { status: 200 }
    );
  }

  const body = await req.json();
  const { email, invite_code, inviter_name, household_name } = body;

  if (!email || !invite_code) {
    return NextResponse.json({ error: "email and invite_code are required" }, { status: 400 });
  }

  const joinUrl = `${APP_URL}/join/${invite_code}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
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
                Once you join, you'll see photos organized by people, places, and moments — all
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
                Kindred Photos · A product of Kindling Signal<br>
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
