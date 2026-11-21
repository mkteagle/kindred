import Foundation

/// ISO calendar days sent to the catalog API. Its upper date bound is inclusive.
struct SearchDateRange: Equatable {
    let start: String
    let end: String
    let label: String

    struct Parsed {
        let original: String
        let text: String
        let date: SearchDateRange?
    }

    private static let monthNames = [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december",
    ]
    private static let monthPattern = /(?i)\b(?:(?:taken\s+(?:in|during|on)|in|during|from|on)\s+)?(January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept|Sep|October|Oct|November|Nov|December|Dec)\.?\s+(\d{4})\b/
    private static let isoPattern = /(?i)\b(?:(?:taken\s+(?:in|during|on)|in|during|from|on)\s+)?(\d{4})-(\d{2})(?:-(\d{2}))?(?![\w-])/

    static func parse(_ value: String) -> Parsed {
        let original = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if let match = original.firstMatch(of: monthPattern),
           let monthIndex = monthNames.firstIndex(where: { $0.hasPrefix(match.1.lowercased()) }),
           let year = Int(match.2), let date = makeRange(year: year, month: monthIndex + 1) {
            return parsed(original, removing: match.range, date: date)
        }
        if let match = original.firstMatch(of: isoPattern),
           let year = Int(match.1), let month = Int(match.2),
           let date = makeRange(year: year, month: month, day: match.3.flatMap { Int($0) }) {
            return parsed(original, removing: match.range, date: date)
        }
        return Parsed(original: original, text: original, date: nil)
    }

    static var thisYear: Self {
        let year = Calendar(identifier: .gregorian).component(.year, from: .now)
        return Self(start: dateString(year, 1, 1), end: dateString(year, 12, 31), label: String(year))
    }

    func contains(_ date: String?) -> Bool {
        guard let date else { return false }
        let day = date.prefix(10)
        return day >= start[...] && day <= end[...]
    }

    private static func parsed(_ original: String, removing span: Range<String.Index>, date: Self) -> Parsed {
        let remainder = String(original[..<span.lowerBound]) + " " + original[span.upperBound...]
        return Parsed(original: original, text: remainder.split(whereSeparator: \.isWhitespace).joined(separator: " "), date: date)
    }

    private static func makeRange(year: Int, month: Int, day: Int? = nil) -> Self? {
        guard (1000...9999).contains(year), (1...12).contains(month) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let firstDay = calendar.date(from: DateComponents(year: year, month: month, day: 1)),
              let days = calendar.range(of: .day, in: .month, for: firstDay) else { return nil }
        let monthName = monthNames[month - 1].capitalized
        if let day {
            guard days.contains(day) else { return nil }
            let value = dateString(year, month, day)
            return Self(start: value, end: value, label: "\(monthName) \(day), \(year)")
        }
        return Self(start: dateString(year, month, 1), end: dateString(year, month, days.count),
                    label: "\(monthName) \(year)")
    }

    private static func dateString(_ year: Int, _ month: Int, _ day: Int) -> String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }
}
