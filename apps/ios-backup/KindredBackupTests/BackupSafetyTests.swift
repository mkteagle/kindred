import XCTest
@testable import KindredBackup

final class BackupSafetyTests:XCTestCase {
    func record() -> BackupRecord {
        var value=BackupRecord(id:"id",scope:"household-a",assetID:"photo",revision:"revision-a",albums:[],createdAt:nil)
        value.phase = .verified;value.serverID="server-id"
        value.resources=[BackupResource(key:"photo",filename:"image.heic",media_type:"image/heic",byte_size:100,sha256:"a",is_primary:true,id:"photo-resource",received_bytes:100),
                         BackupResource(key:"live",filename:"live.mov",media_type:"video/quicktime",byte_size:200,sha256:"b",is_primary:false,id:"video-resource",received_bytes:200)]
        return value
    }
    func test_cleanup_requires_current_account_and_current_revision() {
        let value=record()
        XCTAssertTrue(value.canReviewForCleanup(scope:"household-a",revision:"revision-a"))
        XCTAssertFalse(value.canReviewForCleanup(scope:"household-b",revision:"revision-a"))
        XCTAssertFalse(value.canReviewForCleanup(scope:"household-a",revision:"edited-revision"))
        var pending=value;pending.phase = .uploading
        XCTAssertFalse(pending.canReviewForCleanup(scope:"household-a",revision:"revision-a"))
    }
    func test_a_receipt_missing_the_live_photo_video_is_rejected() {
        let value=record()
        let incomplete=BackupManifest(id:"server-id",revision:"revision-a",resources:[value.resources[0]],state:"verified",verified_at:1,verification_id:"new-check")
        XCTAssertThrowsError(try value.validate(incomplete))
    }
    func test_checksum_or_size_mismatch_cannot_authorize_cleanup() {
        let value=record()
        var wrong=value.resources
        wrong[1]=BackupResource(key:"live",filename:"live.mov",media_type:"video/quicktime",byte_size:200,sha256:"wrong",is_primary:false,id:"video-resource",received_bytes:200)
        let receipt=BackupManifest(id:"server-id",revision:"revision-a",resources:wrong,state:"verified",verified_at:1,verification_id:"new-check")
        XCTAssertThrowsError(try value.validate(receipt))
    }
    @MainActor
    func test_queue_receipts_survive_a_restart_without_crossing_accounts() throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        let store=BackupStore(root:root)
        let value=record();try store.save(value)
        let restored=BackupStore(root:root)
        XCTAssertEqual(restored.records[value.id]?.serverID,"server-id")
        XCTAssertEqual(restored.records[value.id]?.scope,"household-a")
    }
}
