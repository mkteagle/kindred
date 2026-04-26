import SwiftUI

struct OnboardingView: View {
    @State private var currentPage = 0
    let onComplete: () -> Void

    private let pages: [(eyebrow: String, title: String, subtitle: String)] = [
        (
            "Welcome to Kindred",
            "A calmer home for\nfamily photos.",
            "Backed up to your Flickr, organized by household — without ever leaving your hands."
        ),
        (
            "AI-powered",
            "We find the people,\nplaces, and moments.",
            "Face recognition, object detection, and scene understanding — all running on your own server."
        ),
        (
            "Family first",
            "One household,\nevery memory.",
            "Invite your family. Everyone sees the same library, organized by AI, backed by Flickr."
        ),
        (
            "Private by design",
            "Your photos never\nleave your control.",
            "Self-hosted backend, Flickr storage you own, no third-party access. Ever."
        ),
    ]

    var body: some View {
        ZStack {
            KindredTheme.paper.ignoresSafeArea()

            VStack(spacing: 0) {
                // Photo scatter
                photoScatter
                    .padding(.top, 40)

                // Text content
                VStack(alignment: .leading, spacing: 0) {
                    KindredEyebrow(text: pages[currentPage].eyebrow, color: KindredTheme.gold)
                        .padding(.bottom, 10)

                    Text(pages[currentPage].title)
                        .font(.kindredH1)
                        .foregroundStyle(KindredTheme.ash)
                        .lineSpacing(-2)
                        .padding(.bottom, 12)

                    Text(pages[currentPage].subtitle)
                        .font(.kindredBody)
                        .foregroundStyle(KindredTheme.pine)
                        .lineSpacing(4)
                }
                .padding(.horizontal, 28)
                .padding(.top, 20)

                Spacer()

                // Bottom controls
                VStack(spacing: 18) {
                    // Pagination dots
                    HStack(spacing: 5) {
                        ForEach(0..<pages.count, id: \.self) { i in
                            RoundedRectangle(cornerRadius: KindredTheme.radiusPill)
                                .fill(i == currentPage ? KindredTheme.ember : Color(hex: 0x4A281A).opacity(0.2))
                                .frame(width: i == currentPage ? 22 : 6, height: 6)
                                .animation(.easeOut(duration: 0.24), value: currentPage)
                        }
                    }

                    // CTA
                    KindredButton(
                        title: currentPage < pages.count - 1 ? "Continue" : "Get started",
                        style: .primary,
                        isFullWidth: true
                    ) {
                        if currentPage < pages.count - 1 {
                            withAnimation(.easeOut(duration: 0.24)) {
                                currentPage += 1
                            }
                        } else {
                            onComplete()
                        }
                    }

                    // Join link
                    Button {
                        onComplete()
                    } label: {
                        HStack(spacing: 4) {
                            Text("Have an invite code?")
                                .foregroundStyle(KindredTheme.pine)
                            Text("Join household")
                                .fontWeight(.bold)
                                .foregroundStyle(KindredTheme.ember)
                        }
                        .font(.kindredCaption)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 30)
            }
        }
        .gesture(
            DragGesture(minimumDistance: 30)
                .onEnded { value in
                    if value.translation.width < -50, currentPage < pages.count - 1 {
                        withAnimation { currentPage += 1 }
                    } else if value.translation.width > 50, currentPage > 0 {
                        withAnimation { currentPage -= 1 }
                    }
                }
        )
    }

    // MARK: - Photo Scatter

    private var photoScatter: some View {
        ZStack {
            // Three tilted polaroid-style placeholders
            polaroidPlaceholder(rotation: -6, offsetX: -40, offsetY: 0, zIndex: 2)
            polaroidPlaceholder(rotation: 7, offsetX: 50, offsetY: -15, zIndex: 1)
            polaroidPlaceholder(rotation: -2, offsetX: 0, offsetY: 50, zIndex: 3)
        }
        .frame(height: 280)
    }

    private func polaroidPlaceholder(rotation: Double, offsetX: CGFloat, offsetY: CGFloat, zIndex: Double) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(KindredTheme.canvas)
            .frame(width: 140, height: 175)
            .padding(6)
            .background(KindredTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .rotationEffect(.degrees(rotation))
            .shadow(color: KindredTheme.cardShadow, radius: 18, x: 0, y: 18)
            .offset(x: offsetX, y: offsetY)
            .zIndex(zIndex)
    }
}
