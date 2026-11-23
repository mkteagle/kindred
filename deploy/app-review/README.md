# Kindred App Review server

This installation runs a dedicated database and stores only fictional photos.
The reviewer account can browse and temporarily archive seeded photos.
Uploads, invitations, account changes, and permanent deletions are disabled. It uses neither the household database nor household storage
credentials. Two albums contain 12 generated photos dated November 2025 and
November 2024.

## Run the review API

From the repository root, create a private environment file for the review project
with the following values.

- `KINDRED_REVIEW_DB_PASSWORD` is a unique random 32-byte hex password.
- `KINDRED_REVIEW_PASSWORD` is a unique login password for `kindred-reviewer`.
- `KINDRED_REVIEW_API_URL` is the review-only HTTPS URL accessible to Apple.

```sh
docker compose --env-file deploy/app-review/.env \
  --project-name kindred-app-review -f deploy/app-review/compose.yml up -d --build
```

The review API listens on the NAS loopback interface. You can add a separate
Cloudflare Tunnel and route the review hostname to `http://api:8000`. Store its
token in `KINDRED_REVIEW_TUNNEL_TOKEN` in the private review environment file and
add `--profile public` to the Compose command to start the connector.

## Review instructions

1. Open Kindred Photos and choose **Enter server address**.
2. Enter the review HTTPS URL and continue.
3. Sign in with `kindred-reviewer` and the password recorded in App Store Connect.
4. Open **Library** to see both albums. Search for **November 2025** for the lake
   camping photos. The reviewer account can open **Settings → Indexing**.
5. The sample library is read-only. In a build with local review imports,
   the Library plus button lets reviewers preview up to five copied photos on
   their iPhone for one hour. The copies remain on that device, and the review
   API rejects all uploads.
6. Open a seeded photo and use **More actions → Archive sample** to hide it
   from the current review session for one hour. The sample returns automatically.

For screenshots or a quick preview without a connection, the first-run screen
also offers **Try the demo**. The review server credentials belong in the
private App Review information form.

## Generated photos

The review fixtures were generated with the built-in image generation tool as
two contact sheets and cropped into individual JPEGs. The prompts asked for
candid phone photographs of a fictional household during six lake camping
moments and six home moments. Scenes included a campfire, a canoe at sunrise,
pets, baking, and a garden dinner.
