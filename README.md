# Kindred

**A self-hosted family photo library with automatic face recognition, clustering, and organization.**

Kindred connects to your Flickr library and automatically detects faces, pets, and vehicles in your photos. It clusters them into people and animals, and lets you browse by person, location, event, or timeline. Your photos stay on Flickr — Kindred just indexes and organizes them.

## Features

- **Face recognition** — ArcFace-powered detection and clustering
- **Pet & vehicle detection** — YOLOv8
- **Visual search** — CLIP text search ("kids at the beach")
- **Timeline & locations** — Browse by date or on a map
- **Events** — Automatic event detection
- **Review mode** — Keyboard-driven triage for naming people
- **Manual tagging** — Draw bounding boxes to tag missed faces
- **Custom avatars** — Pick the best photo and crop for each person
- **iOS app** — Native SwiftUI app

## Quick Start

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your credentials
docker compose up -d
```

### Frontend

```bash
cp .env.example .env.local
# Edit .env.local with your backend URL and API key
pnpm install
pnpm build
pnpm start
```

### Documentation

```bash
cd docs
pnpm install
pnpm dev
```

Full documentation at [docs/](./docs/) or run the docs site locally.

## Architecture

```
Flickr (photo storage)
    |
    v
Kindred Backend (FastAPI + PostgreSQL/pgvector)
    |                    |
    v                    v
Kindred Web (Next.js)   Kindred iOS (SwiftUI)
```

- **Backend** — Python FastAPI with InsightFace, YOLOv8, and CLIP. Runs in Docker.
- **Database** — PostgreSQL with pgvector for embedding search
- **Web** — Next.js, deploy on Vercel or self-host
- **iOS** — Native SwiftUI app
- **Storage** — Photos stay on Flickr. Kindred stores only metadata and embeddings.

## Requirements

- VPS with 4GB+ RAM (or any Docker host)
- PostgreSQL with pgvector
- Flickr API credentials
- Node.js 20+ and pnpm

## License

[AGPL-3.0](LICENSE)
