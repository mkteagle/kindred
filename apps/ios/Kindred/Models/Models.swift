import Foundation

// MARK: - Cluster Models

struct ClusterSummary: Codable, Identifiable {
    let id: String
    let label: String?
    let det_count: Int
    let photo_count: Int
    let avatar: String?
    let thumb_url: String?
    let photo_url: String?
}

struct ClusterDetail: Codable {
    let cluster_id: String
    let items: [Detection]
}

struct ClustersSummaryResponse: Codable {
    let clusters: [ClusterSummary]
    let noise_count: Int?
}

// MARK: - Detection

struct Detection: Codable, Identifiable {
    let id: String
    let category: String
    let subtype: String
    let photo_id: String
    let photo_url: String
    let thumb_url: String?
    let flickr_url: String?
    let photo_title: String?
    let owner: String?
    let det_score: Float?
    let chip: String?
}

// MARK: - Stats

struct Stats: Codable {
    let people: CategoryStats
    let pets: CategoryStats
    let vehicles: CategoryStats
}

struct CategoryStats: Codable {
    let detections: Int
    let photos: Int
    let groups: Int?
}

// MARK: - Search

struct SearchResult: Codable, Identifiable {
    var id: String { photo_id + (match_cluster_id ?? "") }
    let photo_id: String
    let distance: Float
    let photo_url: String
    let thumb_url: String?
    let flickr_url: String?
    let photo_title: String?
    let owner: String?
    let match_type: String?
    let match_name: String?
    let match_cluster_id: String?
    let match_category: String?
}

// MARK: - Scenes / Objects

struct SceneGroup: Codable, Identifiable {
    var id: String { photo_id }
    let photo_id: String
    let thumb_url: String?
    let distance: Float?
    let flickr_url: String?
    let photo_url: String
    let photo_title: String?
}

struct ScenesResponse: Codable {
    let scenes: [String: [SceneGroup]]
}

// MARK: - Timeline

struct TimelinePhoto: Codable, Identifiable {
    var id: String { photo_id }
    let photo_id: String
    let thumb_url: String?
    let flickr_url: String?
    let photo_title: String?
    let date_taken: String?
}

struct TimelineMonth: Codable, Identifiable {
    var id: String { month }
    let month: String
    let count: Int
    let photos: [TimelinePhoto]
}

struct TimelineResponse: Codable {
    let months: [TimelineMonth]
}

// MARK: - Locations

struct LocationPhoto: Codable, Identifiable {
    var id: String { photo_id }
    let photo_id: String
    let thumb_url: String?
    let flickr_url: String?
    let photo_title: String?
}

struct LocationGroup: Codable, Identifiable {
    var id: String { name }
    let name: String
    let count: Int
    let lat: Double
    let lng: Double
    let photos: [LocationPhoto]
}

struct LocationsResponse: Codable {
    let locations: [LocationGroup]
}

// MARK: - Duplicates

struct DuplicatePhoto: Codable, Identifiable {
    var id: String { photo_id }
    let photo_id: String
    let thumb_url: String?
    let photo_url: String?
    let flickr_url: String?
}

struct DuplicateGroup: Codable, Identifiable {
    var id: String { photos.first?.photo_id ?? UUID().uuidString }
    let photos: [DuplicatePhoto]
    let similarity: Float
}

struct DuplicatesResponse: Codable {
    let groups: [DuplicateGroup]
}

// MARK: - Sync / Jobs

struct SyncLog: Codable, Identifiable {
    let id: Int
    let started_at: String?
    let finished_at: String?
    let status: String
    let total_photos: Int?
    let new_faces: Int?
    let new_pets: Int?
    let new_vehicles: Int?
    let error: String?
    let job_id: String?
}

struct ScanJob: Codable {
    let status: String
    let progress: Int
    let total: Int
    let message: String
    let counts: JobCounts?
}

struct JobCounts: Codable {
    let people: Int
    let pets: Int
    let vehicles: Int
}

// MARK: - User

struct FlickrUser: Codable {
    let userId: String
    let username: String
    let fullname: String
}

// MARK: - Category

enum ClusterCategory: String, CaseIterable, Identifiable {
    case people, pets, vehicles

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .people: return "People"
        case .pets: return "Pets"
        case .vehicles: return "Vehicles"
        }
    }

    var icon: String {
        switch self {
        case .people: return "person.3.fill"
        case .pets: return "pawprint.fill"
        case .vehicles: return "car.fill"
        }
    }
}

// MARK: - API Requests

struct LabelRequest: Codable {
    let cluster_id: String
    let label: String
    let category: String
}

struct MergeRequest: Codable {
    let source_id: String
    let target_id: String
    let category: String
}

struct DismissRequest: Codable {
    let cluster_id: String
    let category: String
}

struct AssignRequest: Codable {
    let detection_id: String
    let cluster_id: String
    let category: String
}

struct FlickrDeleteRequest: Codable {
    let photo_ids: [String]
}

struct ProcessPhotoRequest: Codable {
    let photo_id: String
    let url: String?
}

// MARK: - Health

struct HealthResponse: Codable {
    let status: String
}
