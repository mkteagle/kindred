"use client";

import { KindlingFooter } from "@/components/kindling-footer";

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <div className="legal-content">
        <span className="eyebrow">Legal</span>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: April 26, 2026</p>

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
          When you create an account or join a household, we collect your display name,
          username, and password (stored as a salted hash — we never store plaintext
          passwords).
        </p>
        <h3>Photo Metadata</h3>
        <p>
          Kindred processes your photos to extract metadata including faces, objects,
          locations, and scenes. This processing occurs on your self-hosted server.
          Photo pixel data is never transmitted to Kindling Signal or any third party.
        </p>
        <h3>Flickr Integration</h3>
        <p>
          If you connect your Flickr account, we store OAuth tokens to access your
          Flickr photo library on your behalf. Your Flickr credentials are never shared
          with other household members.
        </p>
        <h3>Analytics</h3>
        <p>
          We use PostHog for anonymous usage analytics (page views, feature usage).
          No personally identifiable information is sent to PostHog. You can opt out
          by blocking the PostHog domain in your browser.
        </p>

        <h2>3. How We Use Your Information</h2>
        <ul>
          <li>To provide the photo organization and household sharing features</li>
          <li>To authenticate your access to your household&apos;s library</li>
          <li>To improve the application based on aggregate usage patterns</li>
        </ul>

        <h2>4. Data Storage &amp; Security</h2>
        <p>
          Kindred is a self-hosted application. Your photos, metadata, and AI models
          run on infrastructure you control. Kindling Signal does not have access to
          your server, your photos, or your household data.
        </p>
        <p>
          Session tokens are encrypted and transmitted over HTTPS. Passwords are hashed
          using bcrypt. API keys are stored as environment variables, never in code.
        </p>

        <h2>5. Data Sharing</h2>
        <p>
          We do not sell, rent, or share your personal information with third parties.
          Photo data stays on your self-hosted server and your Flickr account.
        </p>

        <h2>6. Household Data</h2>
        <p>
          All members of a household can view the shared photo library. The household
          admin controls membership via invite codes. When you leave a household, your
          account data is removed but photos contributed to the shared library remain.
        </p>

        <h2>7. Your Rights</h2>
        <p>
          You can request deletion of your account at any time by contacting the
          household admin or emailing us at{" "}
          <a href="mailto:sayhello@bykindling.com">sayhello@bykindling.com</a>.
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
