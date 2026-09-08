import { redirect } from "next/navigation";

/**
 * The old sync screen never worked and could not have.
 *
 * It rendered a "Scan in progress" card from /jobs/active, an in-memory dict
 * in the API process that the importer and indexer -- both in other containers
 * -- have no way to write to. The card was unreachable code, and the rest of
 * the page was the pre-redesign shell.
 *
 * /pipelines is the same screen built on state that exists. Keeping this path
 * as a redirect rather than deleting it means old notification links still
 * land somewhere.
 */
export default function SyncPage() {
  redirect("/pipelines");
}
