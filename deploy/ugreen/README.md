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
`kindred-api:recovery-54b251c` image. API recreation no longer terminates the
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
commit, creates a clean release worktree, builds commit-tagged API/web images,
and recreates only Kindred's API, web, and library-worker containers. Database,
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

# Restore the preceding verified release without pulling or building.
sudo /volume1/docker/Files/kindred-git/deploy/ugreen/deploy.py rollback
```

Release worktrees, rendered Compose snapshots, and current/previous deployment
records live under `data/deployments/`. The verified Compose file is copied to
the UGOS project's existing `docker-compose.yaml` path, so the native app agrees
with the deployed configuration. No credentials are printed by verification.

A push to GitHub does not itself deploy: run the deployment command after pushing.
The NAS repository uses public HTTPS reads and does not require GitHub credentials.
SSH must be enabled in UGOS while connecting; check its automatic shutdown timer
if port 22 starts refusing connections again.
