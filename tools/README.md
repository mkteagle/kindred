# Kindred Photos — Bulk Upload Tool

Upload a Google Takeout photo/video archive directly to Flickr with OAuth 1.0a,
then optionally trigger Kindred AI processing for each photo.

Designed for one-time bulk migrations of large archives (tested with 7TB).

## Requirements

- Python 3.9+
- `requests` library (`pip install requests`)

## Getting Your OAuth Credentials

You need four Flickr credentials:

| Credential | What it is | Where to find it |
|---|---|---|
| `FLICKR_API_KEY` | Consumer key (app ID) | Your Flickr app page at https://www.flickr.com/services/apps/ |
| `FLICKR_SECRET` | Consumer secret | Same app page, under "Secret" |
| `FLICKR_OAUTH_TOKEN` | User access token | See below |
| `FLICKR_OAUTH_SECRET` | User access token secret | See below |

### Getting OAuth tokens

**Option A: From the Kindred settings page**

If you have a running Kindred instance with Flickr connected, the tokens are
stored in the database. Query them directly:

```sql
SELECT flickr_oauth_token, flickr_oauth_secret
FROM users
WHERE role = 'admin' AND flickr_oauth_token IS NOT NULL;
```

**Option B: From Kindred backend environment**

If you set them as environment variables for the backend, they are:
- `FLICKR_OAUTH_TOKEN`
- `FLICKR_OAUTH_SECRET`

**Option C: From the Kindred backend status endpoint**

Check `GET /status` (authenticated as admin) — it shows whether Flickr
integration is configured but does not expose the raw tokens for security.

### Getting the Kindred API key

The backend API key (`KINDRED_API_KEY`) is generated when you create a user.
You can also create one from the Kindred settings page or via:

```
POST /api-keys
X-API-Key: <existing_key>
{"name": "Bulk Upload"}
```

The response includes the raw `knd_xxx` key (shown only once).

## Usage

### Basic upload

```bash
python3 bulk-upload.py /path/to/Takeout \
  --api-key YOUR_FLICKR_API_KEY \
  --api-secret YOUR_FLICKR_SECRET \
  --oauth-token YOUR_TOKEN \
  --oauth-secret YOUR_TOKEN_SECRET
```

### With backend notification

```bash
python3 bulk-upload.py /path/to/Takeout \
  --api-key YOUR_FLICKR_API_KEY \
  --api-secret YOUR_FLICKR_SECRET \
  --oauth-token YOUR_TOKEN \
  --oauth-secret YOUR_TOKEN_SECRET \
  --backend https://api.kindredphotos.app \
  --backend-key knd_xxxxxxxxxxxx \
  --workers 3
```

### Using environment variables

```bash
export FLICKR_API_KEY=xxx
export FLICKR_SECRET=xxx
export FLICKR_OAUTH_TOKEN=xxx
export FLICKR_OAUTH_SECRET=xxx
export KINDRED_BACKEND=https://api.kindredphotos.app
export KINDRED_API_KEY=knd_xxxxxxxxxxxx

python3 bulk-upload.py /path/to/Takeout
```

### Dry run (preview without uploading)

```bash
python3 bulk-upload.py /path/to/Takeout --dry-run
```

This scans the directory, shows the first 20 files with metadata, and
estimates the upload time. No credentials required.

## CLI Options

| Flag | Default | Description |
|---|---|---|
| `source_dir` | (required) | Root directory of the Google Takeout archive |
| `--api-key` | env `FLICKR_API_KEY` | Flickr consumer key |
| `--api-secret` | env `FLICKR_SECRET` | Flickr consumer secret |
| `--oauth-token` | env `FLICKR_OAUTH_TOKEN` | Flickr OAuth access token |
| `--oauth-secret` | env `FLICKR_OAUTH_SECRET` | Flickr OAuth access token secret |
| `--backend` | env `KINDRED_BACKEND` | Kindred backend URL |
| `--backend-key` | env `KINDRED_API_KEY` | Kindred API key for auth |
| `--workers N` | 3 | Number of parallel upload threads |
| `--delay N` | 2.0 | Seconds between uploads per worker |
| `--dry-run` | off | Preview mode, no actual uploads |
| `--skip-backend` | off | Upload to Flickr but skip Kindred notification |
| `--verbose` / `-v` | off | Enable debug logging |

## How It Works

1. **Scan**: Recursively finds all supported files (jpg, jpeg, png, gif, heic,
   mp4, mov, avi, mkv, webp, tiff, raw, cr2, nef, arw)
2. **Resume**: Loads `upload_progress.json` from the source directory. Files
   already in the progress file are skipped.
3. **Parse metadata**: For each file, looks for a Google Takeout JSON sidecar
   (e.g., `IMG_1234.jpg.json`) and extracts title, description, date taken,
   and geo coordinates.
4. **Upload**: Sends the file to `https://up.flickr.com/services/upload/` with
   OAuth 1.0a signing. Photos are set to `is_public=0, is_friend=0, is_family=1`.
5. **Notify**: Calls `POST /process-photo` on the Kindred backend so the photo
   enters the AI pipeline (face detection, pet detection, CLIP embeddings, etc).
6. **Track**: Updates `upload_progress.json` after every batch of uploads.
   Failed files are logged to `upload_errors.log`.

### Interrupt and resume

Press Ctrl+C once for a graceful shutdown (finishes current uploads, saves
progress). Press Ctrl+C twice to force exit (still saves progress).

Restart the same command to resume from where you left off.

## Time Estimates

These estimates assume 3 workers with default 2-second delay:

| Archive size | File count (est.) | Estimated time |
|---|---|---|
| 50 GB | ~10,000 | ~6 hours |
| 500 GB | ~100,000 | ~2.5 days |
| 1 TB | ~200,000 | ~5 days |
| 3 TB | ~600,000 | ~14 days |
| 7 TB | ~1,400,000 | ~33 days |

Actual times depend on file sizes, network speed, and Flickr's rate limits.
Increasing workers to 5 can reduce times by ~40%, but watch for Flickr
rate-limit errors (the script retries automatically with exponential backoff).

For very large archives, consider running in a `tmux` or `screen` session.

## File Structure

When running, the tool creates these files in the source directory:

- `upload_progress.json` — tracks uploaded files (filepath -> Flickr photo ID)
- `upload_errors.log` — log of files that failed after all retries

## Supported File Types

**Photos**: jpg, jpeg, png, gif, heic, webp, tiff, raw, cr2, nef, arw

**Videos**: mp4, mov, avi, mkv

## Google Takeout Structure

The tool handles the standard Takeout layout:

```
Takeout/
  Google Photos/
    2023-06-01/
      IMG_1234.jpg
      IMG_1234.jpg.json    <-- metadata sidecar
    Trip to Paris/
      DSC_0001.nef
      DSC_0001.nef.json
    ...
```

JSON sidecar files provide:
- Title and description
- Date taken (Unix timestamp)
- Geo coordinates (latitude/longitude)
