import SwiftUI
import UIKit
import Photos

final class BackupAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
        if identifier == BackgroundTransfer.identifier { BackgroundTransfer.shared.setFinishHandler(completionHandler) }
        else { completionHandler() }
    }
}
@main @MainActor
struct KindredBackupApp: App {
    @UIApplicationDelegateAdaptor(BackupAppDelegate.self) var delegate
    @Environment(\.scenePhase) private var phase
    init() { BackupController.shared.configure() }
    var body: some Scene {
        WindowGroup {
            BackupRootView().tint(Color(red:0.396,green:0.329,blue:0.753))
                .task { await BackupController.shared.activate() }
                .onChange(of:phase) { _,value in
                    if value == .active { Task { await BackupController.shared.activate() } }
                    if value == .background { BackupController.shared.schedule() }
                }
        }
    }
}
struct BackupBrand: View {
    var body: some View {
        HStack(spacing:12) {
            ZStack {
                RoundedRectangle(cornerRadius:9).fill(Color(red:0.396,green:0.329,blue:0.753)).frame(width:23,height:32).rotationEffect(.degrees(-25)).offset(x:-10)
                RoundedRectangle(cornerRadius:9).fill(Color(red:0.95,green:0.55,blue:0.44)).frame(width:23,height:32).rotationEffect(.degrees(25)).offset(x:7,y:-5)
                Circle().fill(Color(red:0.21,green:0.67,blue:0.61)).frame(width:20,height:20).offset(x:3,y:13)
            }.frame(width:50,height:48)
            VStack(alignment:.leading,spacing:0) { Text("kindred").font(.system(size:30,weight:.bold,design:.rounded)); Text("BACKUP").font(.system(size:10,weight:.semibold,design:.rounded)).tracking(4).foregroundStyle(.secondary) }
        }
    }
}
struct BackupRootView: View {
    @State private var controller = BackupController.shared
    var body: some View {
        Group {
            if controller.account == nil { ConnectBackupView() }
            else { TabView {
                BackupHomeView().tabItem { Label("Backup",systemImage:"arrow.up.doc") }
                BackupAlbumsView().tabItem { Label("Albums",systemImage:"rectangle.stack") }
                BackupSettingsView().tabItem { Label("Settings",systemImage:"slider.horizontal.3") }
            } }
        }.alert("Kindred Backup",isPresented:Binding(get:{controller.message != nil},set:{if !$0 {controller.message=nil}})) { Button("OK",role:.cancel) { controller.message=nil } } message: { Text(controller.message ?? "") }
    }
}
struct ConnectBackupView: View {
    @State private var controller = BackupController.shared
    @State private var server=""
    @State private var code=""
    @State private var username=""
    @State private var password=""
    @State private var pairing=true
    var body: some View {
        NavigationStack { Form {
            Section {
                VStack(alignment:.leading,spacing:20) {
                    BackupBrand()
                    Text("A little more room.\nEvery memory, home.").font(.system(size:34,weight:.bold,design:.rounded))
                    Text("Back up your chosen photo albums to your own NAS. Review verified copies before removing originals from Photos.").foregroundStyle(.secondary)
                }.padding(.vertical,20)
            }.listRowBackground(Color.clear)
            Section("Your Kindred server") {
                TextField("https://your-server.example",text:$server).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                Picker("Sign in with",selection:$pairing) { Text("Pairing code").tag(true); Text("Account").tag(false) }.pickerStyle(.segmented)
                if pairing {
                    SecureField("One-time pairing code",text:$code).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Text("Get a code from Kindred’s Pair device screen. Google and Apple sign-in stay on the website.").font(.footnote).foregroundStyle(.secondary)
                } else {
                    TextField("Username or email",text:$username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password",text:$password)
                }
                Button { Task {
                    do { try await controller.connect(server:server,code:pairing ? code:"",username:username,password:password);code="";password="" }
                    catch { controller.message=error.localizedDescription }
                } } label: { HStack { Text("Connect to my library");Spacer();if controller.busy { ProgressView() } else { Image(systemName:"arrow.right") } } }
                .disabled(controller.busy || server.isEmpty || (pairing ? code.isEmpty:username.isEmpty || password.isEmpty))
            }
            Section { Label("Your server. Your albums. Your copies.",systemImage:"lock.shield").font(.footnote).foregroundStyle(.secondary) }.listRowBackground(Color.clear)
        }.navigationBarTitleDisplayMode(.inline) }
    }
}
struct BackupHomeView: View {
    @State private var controller=BackupController.shared
    @State private var cleanup=false
    var body: some View {
        NavigationStack { List {
            Section { BackupBrand().padding(.vertical,12) }.listRowBackground(Color.clear)
            Section {
                VStack(alignment:.leading,spacing:14) {
                    Text("Your memories,\nsafely home.").font(.system(size:30,weight:.bold,design:.rounded))
                    HStack(alignment:.firstTextBaseline) {
                        Text(controller.verified.count,format:.number).font(.system(size:42,weight:.bold,design:.rounded))
                        Text("items verified on NAS").foregroundStyle(.secondary)
                    }
                    Text(ByteCountFormatter.string(fromByteCount:controller.backedUpBytes,countStyle:.file)+" backed up").font(.subheadline).foregroundStyle(.secondary)
                    Label(controller.wifiOnly && !controller.isWiFi ? "Waiting for Wi-Fi":"\(controller.pending) items waiting or in progress",systemImage:controller.wifiOnly && !controller.isWiFi ? "wifi":"arrow.triangle.2.circlepath")
                    Button { Task { await controller.syncNow() } } label: { Label("Sync now",systemImage:"arrow.up.circle.fill").frame(maxWidth:.infinity) }.buttonStyle(.borderedProminent).controlSize(.large).disabled(controller.busy)
                    if controller.records.contains(where:{[.uploading,.preparing,.verifying].contains($0.phase)}) { Button("Pause transfers") { Task { await controller.pause() } }.font(.footnote) }
                    Text("Automatic backups run when iOS allows. Opening this app helps a large first backup finish sooner.").font(.footnote).foregroundStyle(.secondary)
                }.padding(.vertical,10)
            }
            Section {
                Button { cleanup=true } label: { Label("Review backed-up items",systemImage:"checkmark.shield") }.disabled(controller.verified.isEmpty)
                Text("Review first. Kindred checks the NAS copies again before Photos asks you to confirm deletion.").font(.footnote).foregroundStyle(.secondary)
            }
            if !controller.records.isEmpty { Section("Recent activity") {
                ForEach(Array(controller.records.prefix(30))) { record in
                    HStack(spacing:12) {
                        AssetThumbnail(identifier:record.assetID)
                        VStack(alignment:.leading,spacing:3) {
                            Text(record.resources.first(where:{$0.is_primary})?.filename ?? "Preparing original").lineLimit(1)
                            Text(phaseLabel(record.phase)).font(.caption).foregroundStyle(record.phase == .failed ? Color.red:Color.secondary)
                            if let error=record.error { Text(error).font(.caption2).foregroundStyle(.red).lineLimit(2) }
                        }
                        Spacer(minLength:0)
                        if record.phase == .verified { Image(systemName:"checkmark.circle.fill").foregroundStyle(.teal) }
                        else if [.preparing,.verifying,.uploading].contains(record.phase) { ProgressView() }
                    }.padding(.vertical,3)
                }
                if controller.records.contains(where:{$0.phase == .failed}) { Button("Retry interrupted backups") { Task { await controller.retry() } } }
            } }
        }.navigationTitle("Backup").navigationBarTitleDisplayMode(.inline).sheet(isPresented:$cleanup) { CleanupBackupView() } }
    }
    func phaseLabel(_ phase:BackupPhase)->String {
        switch phase {
        case .pending:return "Waiting to back up"
        case .preparing:return "Getting originals from Photos"
        case .uploading:return "Uploading to your NAS"
        case .verifying:return "Checking saved originals"
        case .verified:return "Verified on your NAS"
        case .failed:return "Needs attention"
        case .deleted:return "Removed from Photos · NAS copy kept"
        }
    }
}
struct AssetThumbnail: View {
    let identifier:String
    @State private var image:UIImage?
    var body:some View {
        Group { if let image { Image(uiImage:image).resizable().scaledToFill() } else { Image(systemName:"photo").foregroundStyle(.secondary) } }
            .frame(width:46,height:54).background(.quaternary).clipShape(RoundedRectangle(cornerRadius:9))
            .task(id:identifier) {
                guard let asset=PHAsset.fetchAssets(withLocalIdentifiers:[identifier],options:nil).firstObject else{return}
                let options=PHImageRequestOptions();options.isNetworkAccessAllowed=false
                PHImageManager.default().requestImage(for:asset,targetSize:CGSize(width:100,height:120),contentMode:.aspectFill,options:options) { value,_ in Task { @MainActor in image=value } }
            }
    }
}
struct BackupAlbumsView:View {
    @State private var controller=BackupController.shared
    var body:some View {
        NavigationStack { List {
            Section { Text("Choose the albums to keep on your NAS. New items in these albums join your next backup.").foregroundStyle(.secondary) }
            if controller.permission == .limited { Section { Text("Photos access is limited. Only the items you allowed are available.").font(.footnote);Button("Manage Photos access") { UIApplication.shared.open(URL(string:UIApplication.openSettingsURLString)!) } } }
            if controller.permission != .authorized && controller.permission != .limited { Button("Allow Photos access") { Task { await controller.requestPhotos() } } }
            Section("Albums to back up") { ForEach(controller.albums) { album in
                Toggle(isOn:Binding(get:{controller.selectedAlbums.contains(album.id)},set:{enabled in
                    if enabled {controller.selectedAlbums.insert(album.id)} else {controller.selectedAlbums.remove(album.id)}
                    controller.savePreferences()
                })) { HStack { Text(album.name);Spacer();Text(album.count,format:.number).foregroundStyle(.secondary) } }
            } }
        }.navigationTitle("Your albums") }
    }
}
struct BackupSettingsView:View {
    @State private var controller=BackupController.shared
    var body:some View {
        NavigationStack { Form {
            Section("Backup preferences") {
                Toggle("Back up automatically",isOn:$controller.automatic).onChange(of:controller.automatic) { _,_ in controller.savePreferences() }
                Toggle("Use Wi-Fi only",isOn:$controller.wifiOnly).onChange(of:controller.wifiOnly) { _,_ in controller.savePreferences() }
                Text("iOS chooses when background discovery can run. Transfers handed to iOS can continue while the screen is locked.").font(.footnote).foregroundStyle(.secondary)
            }
            Section("Your library") {
                LabeledContent("Server",value:URL(string:controller.account?.server ?? "")?.host ?? "Your server")
                Text("Uploads go to your own Kindred installation. No shared Kindling database or cloud-storage account.").font(.footnote).foregroundStyle(.secondary)
                Button("Disconnect",role:.destructive) { Task {do {try await controller.disconnect()} catch {controller.message=error.localizedDescription}} }.disabled(controller.busy)
            }
            Section("Removing originals") {
                Text("Kindred never deletes automatically. It checks every original resource again, then asks Photos to confirm your selected deletions.")
                Text("With iCloud Photos enabled, deleting from Photos also deletes from iCloud and your other synced devices. Deleted items remain in Recently Deleted according to iOS’s retention rules.").font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("Settings") }
    }
}
struct CleanupBackupView:View {
    @Environment(\.dismiss) private var dismiss
    @State private var controller=BackupController.shared
    @State private var selection=Set<String>()
    @State private var confirm=false
    @State private var working=false
    var body:some View {
        NavigationStack {
            List(selection:$selection) {
                Section {
                    Text("Choose up to 50 verified items. Kindred checks their NAS originals again before asking Photos to delete anything.")
                    Text("With iCloud Photos enabled, deletion also affects iCloud and synced devices. NAS copies stay.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(controller.verified) { record in
                    HStack { AssetThumbnail(identifier:record.assetID);VStack(alignment:.leading) {Text(record.resources.first(where:{$0.is_primary})?.filename ?? "Backed-up item").lineLimit(1);Text(ByteCountFormatter.string(fromByteCount:record.bytes,countStyle:.file)).font(.caption).foregroundStyle(.secondary)} }.tag(record.id)
                }
            }.environment(\.editMode,.constant(.active)).disabled(working)
                .navigationTitle("Review originals").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement:.cancellationAction) {Button("Close"){dismiss()}.disabled(working)} }
                .safeAreaInset(edge:.bottom) {
                    VStack(spacing:8) {
                        if working {ProgressView("Rechecking the NAS copies…")}
                        Button("Remove \(selection.count) from Photos",role:.destructive){confirm=true}.buttonStyle(.borderedProminent).tint(.red).disabled(selection.isEmpty || selection.count>50 || working)
                    }.padding().frame(maxWidth:.infinity).background(.regularMaterial)
                }
                .confirmationDialog("Remove these originals from Photos?",isPresented:$confirm,titleVisibility:.visible) {
                    Button("Verify copies and remove originals",role:.destructive) {
                        working=true
                        Task { do {try await controller.deleteVerified(selection);dismiss()} catch {controller.message=error.localizedDescription};working=false }
                    }
                } message: { Text("NAS copies stay. With iCloud Photos enabled, deletion syncs to iCloud and other devices. Nothing is removed if verification fails.") }
        }.interactiveDismissDisabled(working)
    }
}
