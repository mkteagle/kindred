# Proposed Kindred SSD layout

Inspection on November 19, 2026 confirmed that `/app/data/thumbnails` currently resolves to `/volume1/docker/Files/kindred/deploy/ugreen/data/backend/thumbnails`. This is the 46 TiB HDD RAID5 volume, exposed through `/dev/bcache0`. The existing approximately 2 TB M.2 is assigned to an SSD cache, currently in write-around/read-cache mode. It is not a dedicated filesystem for Kindred's thumbnail files.

A sample of 512 thumbnails averaged 29,232 bytes. At that sampled average, 2,557,635 previews require approximately 74.8 GB before filesystem overhead or future growth. This is a projection, not a measured size of the completed library.

Recommended layout, pending the owner's choice:

- Existing HDD volume: photo/video originals, Takeout archives, and database backups.
- Dedicated M.2 SSD storage volume: persistent Kindred thumbnails and optionally the database and other small application data.
- Generated previews remain disposable; the database requires verified backups to the HDD volume before moving it.

The M.2 currently serves the entire NAS as read cache. UGREEN's managed SSD-pool route requires safely removing that cache and creating the new SSD storage pool. It must not be confused with changing one Docker folder mapping. No cache removal, drive formatting, logical-volume creation, or storage migration has been performed.

An alternative is a custom Linux volume in the 400,430,202,880 bytes of free extents in the SSD cache volume group. This would leave existing cache logical volumes intact, but would not be the ordinary UGREEN-managed storage-pool layout. Do not create this layout without the owner's selection.

Preparation runs on the NAS as `kindred-ssd-migration-prepare.service`. Protected configuration backups, container mount manifests, an online custom-format PostgreSQL dump, and its archive directory are stored in `data/ssd-migration`. A readable archive directory verifies the dump format; it is not a test restore. Verify preparation completion and backup freshness before any storage change.

Migration checks after the storage destination is chosen:

1. Verify the exact SSD device and current clean-cache state in NAS Storage.
2. Prepare the selected SSD storage volume without modifying HDD originals.
3. Copy thumbnails on the NAS while retaining the original cache for rollback.
4. Complete a final copy during a brief controlled cutover, update persistent mounts, and verify the API and workers see the SSD-backed destination.
5. Verify thumbnail HTTP delivery, resumed committed counts, reboot/startup dependencies, and measured throughput before declaring the move complete.
6. If the database is also moved, preserve its stopped original data directory until row counts, authentication, album access, media delivery, and backup restoration have been verified. A single SSD is not redundant; keep independent database backups on the HDD volume.

References:

- https://support.ugnas.com/detail/article/en-GB/415
- https://ai.ugreen.com/blogs/how-to/mix-ssds-hdds-nas-setup
- https://docs.kernel.org/admin-guide/bcache.html
