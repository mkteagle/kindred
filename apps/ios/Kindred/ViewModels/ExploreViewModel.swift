import Foundation

@Observable
final class ExploreViewModel {
    // Timeline
    var timeline: [TimelineMonth] = []
    var isLoadingTimeline = true

    // Locations
    var locations: [LocationGroup] = []
    var isLoadingLocations = false

    // Scenes (Landmarks)
    var scenes: [String: [SceneGroup]] = [:]
    var isLoadingScenes = false

    // Objects
    var objects: [String: [SceneGroup]] = [:]
    var isLoadingObjects = false

    // Duplicates
    var duplicates: [DuplicateGroup] = []
    var isLoadingDuplicates = false

    var error: String?

    func loadTimeline() async {
        isLoadingTimeline = true
        error = nil
        do {
            let response = try await APIClient.shared.getTimeline()
            timeline = response.months
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingTimeline = false
    }

    func loadLocations() async {
        isLoadingLocations = true
        error = nil
        do {
            let response = try await APIClient.shared.getLocations()
            locations = response.locations
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingLocations = false
    }

    func loadScenes() async {
        isLoadingScenes = true
        error = nil
        do {
            let response = try await APIClient.shared.getScenes()
            scenes = response.scenes
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingScenes = false
    }

    func loadObjects() async {
        isLoadingObjects = true
        error = nil
        do {
            let response = try await APIClient.shared.getObjects()
            objects = response.scenes
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingObjects = false
    }

    func loadDuplicates() async {
        isLoadingDuplicates = true
        error = nil
        do {
            let response = try await APIClient.shared.getDuplicates()
            duplicates = response.groups
        } catch {
            self.error = error.localizedDescription
        }
        isLoadingDuplicates = false
    }

    func deleteDuplicatePhotos(photoIds: [String]) async {
        do {
            try await APIClient.shared.flickrDelete(photoIds: photoIds)
            // Remove deleted photos from duplicate groups
            for i in duplicates.indices {
                duplicates[i] = DuplicateGroup(
                    photos: duplicates[i].photos.filter { !photoIds.contains($0.photo_id) },
                    similarity: duplicates[i].similarity
                )
            }
            duplicates.removeAll { $0.photos.count < 2 }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
