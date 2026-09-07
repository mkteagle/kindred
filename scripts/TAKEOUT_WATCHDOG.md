# Takeout recovery runner

Run `python3 scripts/takeout_codex_watchdog.py` on the logged-in Mac.
Use `--once` for a read-only status snapshot. The default runtime directory is
`~/Library/Logs/KindredTakeout`; `status.json` records monitoring/recovery state,
`recovery.jsonl` records Codex events, and `last-recovery.txt` records its result.
The lock file prevents overlapping runner instances.

The runner polls actual NAS files every 60 seconds over SSH. After ten minutes
without byte growth or a newly completed archive, it invokes the desktop app's
bundled `codex exec` with the existing authenticated account and computer-use
tools. Recovery is bounded to 12 minutes and backs off on repeated failures.
Agent success does not reset the stall timer: subsequent filesystem growth does.

The Mac must remain awake, connected to the NAS, and logged in for computer use.
NAS downloads remain independent of the Mac. This runner is specific to the
September 6 export's 140 canonical filenames; duplicates do not count. Completion
requires readable ZIP directories for every canonical part and no partial files;
it does not claim a full CRC scan of every archive member.

Recovery agents must inspect and pause the existing queue/supervisor before
operating the browser, then restore them. Authentication comes before download
submission, and advancing downloads must be left alone. Source files are never
deleted. MFA or other required user interaction remains a reported blocker.
