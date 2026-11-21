# NAS-local Takeout cleanup

The worker and independent alert watchdog run as user systemd services on the NAS, with lingering enabled. They continue after SSH logout and start at boot. No Mac, browser, Codex automation, or cloud worker is required.

Current installation: `/volume1/docker/Files/kindred/deploy/ugreen/data/consolidation`.

## Scope and safety

The worker waits for Kindred's current discovery pass to finish, inventories the existing `/volume1/Family/Photos` library, and checks media in `/volume1/Family/_takeout/Jen` and `/volume1/Family/_takeout/Michael`. It uses size and sampled bytes only to find candidates. Before removing a staging file, it reads both files completely, compares SHA-256, checks that neither changed, and commits a durable receipt to `ledger.sqlite3`.

It never deletes library files, raw ZIPs, sidecars, unmatched originals, or different-byte variants. A finished cleanup pass does **not** mean all archives are reconciled or all library-internal duplicates are resolved. Retained files and errors are reported explicitly. Logical bytes removed can exceed physical space reclaimed when files share storage extents or snapshots retain them.

Folder inventory and checked-file receipts survive restart. Only one worker can acquire the job lock. Reading large media updates the heartbeat every five seconds; the watchdog also checks the discovery heartbeat while waiting. A 30-minute lapse triggers a stall alert.

## Services

Run these commands on the NAS as `mkteagle`:

```sh
systemctl --user status kindred-consolidation.service kindred-consolidation-watch.service
journalctl --user -u kindred-consolidation.service -n 30
cat /volume1/docker/Files/kindred/deploy/ugreen/data/consolidation/status.json
```

`config.json`, `status.json`, `report.json`, `ledger.sqlite3`, and notification receipts live on the NAS. The separate watchdog retries failed email delivery every 30 seconds. Credentials are in `resend.env`, mode 0600, scoped to sending from `mail.kindredphotos.app`. Alerts go to `mkteagle@gmail.com`. The test message was accepted by Resend from the NAS on November 18, 2026.

Source: `scripts/nas_consolidate.py`. Installation helper: `scripts/install_nas_consolidation.py` (execute on the NAS after copying the worker). Enable persistent user services with `loginctl enable-linger mkteagle` and confirm `Linger=yes`.

The watchdog cannot send email while the entire NAS is powered off or its network is down. Its services resume when the NAS returns.
