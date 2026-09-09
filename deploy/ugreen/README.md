# Kindred on UGREEN NAS

This directory packages the complete Kindred runtime as one UGOS Docker
Project. The core database, API, and web services can run while the NAS RAID is
initializing. Do not start photo imports, automatic scans, or mobile backups
until storage synchronization has completed.

## Services

- `database`: PostgreSQL 16 with pgvector, private to the Docker network
- `api`: FastAPI and the local ML pipeline
- `web`: the production Next.js standalone server
- `tunnel`: outbound-only Cloudflare Tunnel ingress, disabled until the
  `public` Compose profile is explicitly enabled

No container publishes a host port. Cloudflare routes public hostnames directly
to the private service names (`http://web:3000` and `http://api:8000`). UGOS,
PostgreSQL, SMB, NFS, and Docker must remain private.

## Persistent folders

All state lives below `data/` beside the Compose file:

```text
data/
  postgres/     Database and vector metadata
  photos/       NAS originals (added by the storage-provider phase)
  backend/      Backend working data
  model-cache/  Downloaded ML models and caches
```

Back up `postgres/` and `photos/`. The model cache is reproducible and does not
need backup protection.

## Before first start

1. Copy `.env.example` to `.env` and replace every placeholder secret.
2. Import this directory through **Docker → Project → Create** in UGOS.
3. Start the core project and verify the database, API, and web containers.
4. Create a named Cloudflare Tunnel for staging.
5. Route `nas.kindredphotos.app` to `http://web:3000`.
6. Route `nas-api.kindredphotos.app` to `http://api:8000`.
7. Enable the `public` Compose profile after the token and routes are ready.
8. Wait for UGOS Storage Manager to report that RAID synchronization is done
   before starting any photo import, scan, or mobile backup.

The tunnel token is a credential. Keep it only in the NAS project `.env` and
rotate it if it is ever copied into logs, screenshots, chat, or Git.

## Deployment gate

The current backend still assumes an existing Kindred database schema and uses
Flickr as the canonical photo provider. Do not deploy this stack as a fresh
production replacement until the database bootstrap/migration and NAS storage
provider tasks are complete. This Compose project is the runtime foundation,
not the data migration itself.

## Checkpoint import and indexing worker

The `library-worker` service runs independently from the API using the
same commit-tagged API image. The importer and indexer run concurrently, with
a final indexing pass after import finishes. API recreation no longer terminates the
import job. Both importer entry points share a nonblocking checkpoint lock;
checkpoint writes use unique temporary files and atomic replacement.

The worker reads only the staged media at `/data/photos/imports/AllPhotos`.
It does not download or extract Google Takeout exports. Original HEIC files
remain on the NAS; Flickr receives JPEG conversions, and local indexing uses
temporary decoded JPEGs. Failed Flickr mirrors do not prevent local indexing.

Persistent operational files under `data/backend/`:

- `staged-import-progress.json`: import receipts and per-file failures.
- `nas-worker-status.json`: active phase, completion, or retry cooldown.
- `nas-worker-import.log` and `nas-worker-index.log`: phase output.

A PID file alone is not proof of a live worker. Check Docker's container/process
state and advancing logs. The worker retries unsuccessful passes after five
minutes and exits successfully when both passes finish without failures.
Use `library_status.py` inside the API container to verify final counts.

## Git-based production releases

The NAS Git checkout is `/volume1/docker/Files/kindred-git`. The original
`/volume1/docker/Files/kindred/deploy/ugreen` directory remains the runtime
location for `.env`, database files, originals, model caches, and checkpoints.
Do not copy those data directories into Git.

From an SSH session on the NAS, deploy the current remote main branch with:

```sh
sudo /volume1/docker/Files/kindred-git/deploy/ugreen/deploy.py deploy
```

The command fetches Git, fast-forwards the clean NAS checkout, resolves one exact
commit, creates a clean release worktree, builds a commit-tagged API image,
and recreates only Kindred's API, library-worker, and video-worker containers.
The public web app deploys separately through the Vercel Git integration. The
optional NAS web container is left running at its existing revision. Database,
tunnel, Firefox, and other Docker projects are outside the deployment operation.
Production source bind mounts are removed: the running code comes from the
image, not a separately copied Python file.

After recreation it checks the running image's Git revision label and container
health, then tests library counts, gallery loading, and an image preview. A failed
rollout restores the previous application containers. Normal Docker layer caching
is retained; source changes still produce a new build and deployment is verified
against the exact commit. `--no-cache` is not needed for ordinary code updates.

```sh
# Inspect deployed commit, image IDs, and current container status.
sudo /volume1/docker/Files/kindred-git/deploy/ugreen/deploy.py status

# Deploy an explicit Git commit or tag.
sudo /volume1/docker/Files/kindred-git/deploy/ugreen/deploy.py deploy --ref COMMIT_OR_TAG

# Restore the preceding backend release without pulling or building.
sudo /volume1/docker/Files/kindred-git/deploy/ugreen/deploy.py rollback
```

Release worktrees, rendered Compose snapshots, and current/previous deployment
records live under `data/deployments/`. Backend and NAS web have separate
`backend-current.json` / `backend-previous.json` and `web-current.json` /
`web-previous.json` records. Older combined records are read as a migration
fallback, with services restricted to the requested target even on rollback.
One shared lock prevents overlapping deployments.

Use this script for application updates and rollback. The original UGOS
`docker-compose.yaml` is retained as bootstrap configuration; it is no longer
overwritten with a release that would also repin the other target. Recreating
application containers through that old file could revert their versions.
The target's current record identifies its authoritative Compose snapshot.
No credentials are printed by verification.

Only if you intentionally maintain the separate NAS web copy:

```sh
sudo /volume1/docker/Files/kindred-git/deploy/ugreen/deploy.py deploy --target web
sudo /volume1/docker/Files/kindred-git/deploy/ugreen/deploy.py status --target web
sudo /volume1/docker/Files/kindred-git/deploy/ugreen/deploy.py rollback --target web
```

These commands affect only the NAS web container, never Vercel or the backend.
They do not remove the NAS web container or change tunnel routing.
To adopt this launcher from an older checkout, run the default `deploy` command
(without an old `--ref`): it fetches main and re-executes the updated script
before building. A deployment already running keeps its existing behavior.

A push to GitHub does not itself deploy the NAS backend: run the deployment
command after pushing. Vercel handles public web deployments independently.
The NAS repository uses SSH with a repository-scoped, read-only GitHub deploy
key belonging to the NAS `mkteagle` administrator. The private key stays at
`/home/mkteagle/.ssh/kindred_github_ed25519`; the root-owned checkout configures
its SSH command explicitly so `sudo` deployments use that key. GitHub access
does not depend on the Mac's credentials.

From the configured Mac, `ssh kindred-nas` logs in as `mkteagle` using the separate
`~/.ssh/kindred_nas_ed25519` key. Run the `sudo` deployment command above after
connecting; UGOS administrator privileges still require the account password.
SSH must be enabled in UGOS while connecting; check its automatic shutdown timer
if port 22 starts refusing connections again.
