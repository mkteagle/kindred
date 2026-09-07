import Foundation

/// Demo mode's answers to the catalog endpoints the redesigned screens read.
///
/// App Review signs in to a bundled, offline library, so every new screen has
/// to have a demo path or it shows an empty state to the reviewer. The bundled
/// timeline JSON is the source: it already carries ids, titles and dates, and
/// its `demo://` URLs are rendered by `DemoThumbnailView`.
extension DemoDataProvider {

    /// The whole demo library as one page. Demo data is small enough that
    /// paging it would only add a cursor with nothing behind it.
    func libraryPage(media: MediaFilter = .all) -> LibraryPage {
        let photos = getTimeline().months
            .flatMap(\.photos)
            .map { photo in
                LibraryPhoto(
                    photo_id: photo.photo_id,
                    photo_title: photo.photo_title,
                    date_taken: photo.date_taken,
                    media_kind: .photo,
                    duration_seconds: nil,
                    flickr_url: photo.flickr_url,
                    thumb_url: photo.thumb_url
                )
            }
        // The bundled library is stills only, so a video filter is genuinely empty.
        let filtered = media == .video ? [] : photos
        return LibraryPage(photos: filtered, next_cursor: nil)
    }

    func searchHits(query: String) -> [SearchHit] {
        search(query: query).map { result in
            SearchHit(
                photo_id: result.photo_id,
                photo_title: result.photo_title,
                date_taken: nil,
                media_kind: .photo,
                duration_seconds: nil,
                flickr_url: result.thumb_url ?? result.photo_url,
                distance: Double(result.distance),
                match_type: result.match_type,
                match_name: result.match_name,
                match_cluster_id: result.match_cluster_id,
                match_category: result.match_category
            )
        }
    }

    /// Photos for one cluster, from the bundled detail files.
    func clusterPage(clusterID: String, category: String) -> LibraryPage {
        let detail = getClusterDetail(category: category, clusterId: clusterID)
        let photos = detail.items.map { detection in
            LibraryPhoto(
                photo_id: detection.photo_id,
                photo_title: detection.photo_title,
                date_taken: nil,
                media_kind: .photo,
                duration_seconds: nil,
                flickr_url: detection.flickr_url,
                thumb_url: detection.thumb_url ?? detection.photo_url
            )
        }
        return LibraryPage(photos: photos, next_cursor: nil)
    }

    func counts() -> LibraryCounts {
        let photos = getTimeline().months.reduce(0) { $0 + $1.photos.count }
        return LibraryCounts(
            total_files: photos, photos: photos, videos: 0,
            on_nas: photos, on_flickr: photos,
            indexed_photos: photos, pending_index: 0
        )
    }
}
