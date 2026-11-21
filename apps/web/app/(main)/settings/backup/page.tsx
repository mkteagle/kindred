import Link from "next/link";
import { DiscoveryProgress } from "@/components/kx/discovery-progress";

export default function BackupSettingsPage() {
  return <>
    <h2 className="kx-setting-title">Backup &amp; Sync</h2>
    <p className="kx-setting-description">Your NAS saves the original. Flickr receives a second copy through the household connection.</p>
    <Link className="kx-setting-row" href="/settings/storage">Backup destinations <span aria-hidden="true">›</span></Link>
    <Link className="kx-setting-row" href="/activity">Library activity <span aria-hidden="true">›</span></Link>
    <Link className="kx-setting-row" href="/pipelines">Indexing progress <span aria-hidden="true">›</span></Link>
    <DiscoveryProgress />
  </>;
}
