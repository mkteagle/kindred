"use client";

import { KindlingFooter } from "@/components/kindling-footer";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <div className="legal-content">
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: November 22, 2026</p>

        <h2>1. Introduction</h2>
        <p>
          Kindred Photos (&quot;Kindred,&quot; &quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) is a household photo
          management application developed by Kindling Signal. This Privacy Policy
          explains how we collect, use, and protect your information when you use
          Kindred Photos.
        </p>

        <h2>2. Information We Collect</h2>
        <h3>Account Information</h3>
        <p>
          When you join a household, its Kindred installation stores your display name,
          username, and sign-in information. Passwords are stored as salted hashes.
          If you connect a sign-in provider, the installation stores the information
          needed to verify your identity and disconnect the provider.
        </p>
        <h3>Photo Metadata</h3>
        <p>
          Kindred processes your photos to extract metadata including faces, objects,
          locations, and scenes on the household’s server. The server operator chooses
          where to store originals, catalog metadata, and thumbnails and whether to
          enable a Flickr backup.
        </p>
        <h3>Flickr Integration</h3>
        <p>
          If your household connects Flickr, its Kindred installation stores OAuth
          tokens to authorize that connection. Members use their own Kindred accounts.
        </p>
        <h3>Analytics</h3>
        <p>
          Kindling Signal’s hosted website uses PostHog for usage analytics. Mobile
          backup diagnostics are limited to Kindling Signal’s own household servers,
          where they report technical details such as transfer duration and errors.
        </p>

        <h2>3. How We Use Your Information</h2>
        <ul>
          <li>To provide the photo organization and household sharing features</li>
          <li>To authenticate your access to your household&apos;s library</li>
          <li>To improve the application based on aggregate usage patterns</li>
        </ul>

        <h2>4. Data Storage &amp; Security</h2>
        <p>
          Kindred is a self-hosted application. When you pair with your own Kindred
          installation, that server handles your account, photos, and metadata.
          Kindling Signal does not host independent households.
        </p>
        <p>
          Session tokens are encrypted and transmitted over HTTPS. Passwords are hashed
          using bcrypt. API keys are stored as environment variables, never in code.
        </p>

        <h2>5. Data Sharing</h2>
        <p>
          We do not sell personal information. A household’s server operator chooses
          whether to connect optional providers, such as Flickr for backup or an
          object storage service for thumbnails.
        </p>

        <h2>6. Household Data</h2>
        <p>
          All members of a household can view the shared photo library. The household
          admin controls membership via invite codes. When you leave a household, your
          account data is removed but photos contributed to the shared library remain.
        </p>

        <h2>7. Your Rights</h2>
        <p>
          Open Settings, then Account, then Manage account to delete your account.
          A household owner can transfer ownership before leaving or delete the
          household to close its Kindred installation. Deleting the household removes
          its catalog and accounts. The storage owner manages the files in NAS, R2,
          and Flickr separately.
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update this policy from time to time. Continued use of Kindred after
          changes constitutes acceptance of the updated policy.
        </p>

        <h2>9. Contact</h2>
        <p>
          Questions about this policy? Email us at{" "}
          <a href="mailto:sayhello@bykindling.com">sayhello@bykindling.com</a>.
        </p>
      </div>
      <KindlingFooter />
    </main>
  );
}
