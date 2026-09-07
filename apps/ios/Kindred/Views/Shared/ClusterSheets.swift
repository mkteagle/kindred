import SwiftUI

// MARK: - Rename

struct RenameSheet: View {
    @Binding var nameInput: String
    let entityType: String
    let onSave: (String) -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "pencil.line")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(KindredTheme.accent)
                .padding(.top, 32)

            Text("Rename")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ink)
                .padding(.top, 16)

            Text("Enter a new name for this \(entityType) group.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.inkBody)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            TextField("Name", text: $nameInput)
                .font(.kindredBody)
                .padding(12)
                .background(KindredTheme.fill)
                .clipShape(RoundedRectangle(cornerRadius: KindredTheme.radiusSM))
                .overlay(
                    RoundedRectangle(cornerRadius: KindredTheme.radiusSM)
                        .stroke(KindredTheme.hairlineStrong, lineWidth: 1)
                )
                .padding(.horizontal, 24)
                .padding(.top, 14)

            Spacer()

            VStack(spacing: 10) {
                KindredButton(
                    title: "Save",
                    icon: "checkmark",
                    style: .primary,
                    isFullWidth: true
                ) {
                    onSave(nameInput)
                }

                KindredButton(
                    title: "Cancel",
                    style: .ghost,
                    isFullWidth: true
                ) {
                    onCancel()
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(KindredTheme.sheet)
    }
}

// MARK: - Hashable conformance for navigation

extension ClusterSummary: Hashable {
    static func == (lhs: ClusterSummary, rhs: ClusterSummary) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

// MARK: - Dismiss Group Sheet

struct DismissGroupSheet: View {
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "eye.slash.fill")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(KindredTheme.dangerText)
                .padding(.top, 32)

            Text("Dismiss group?")
                .font(.kindredH2)
                .foregroundStyle(KindredTheme.ink)
                .padding(.top, 16)

            Text("This will dismiss all detections in this group. This cannot be undone.")
                .font(.kindredBody)
                .foregroundStyle(KindredTheme.inkBody)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 8)

            Spacer()

            VStack(spacing: 10) {
                KindredButton(
                    title: "Dismiss",
                    icon: "eye.slash",
                    style: .danger,
                    isFullWidth: true
                ) {
                    onConfirm()
                }

                KindredButton(
                    title: "Cancel",
                    style: .ghost,
                    isFullWidth: true
                ) {
                    onCancel()
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .background(KindredTheme.sheet)
    }
}
