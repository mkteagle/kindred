import type { DateRange } from "@/components/kx/date-facet";

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
const months = Array.from({ length: 12 }, (_, index) =>
  monthFormat.format(new Date(Date.UTC(2000, index, 1))),
);

export function searchCaptureMonth(query: string): { range: DateRange; label: string } | null {
  const match = /^([a-z]+)\.?\s+(\d{4})$/i.exec(query.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const month = months.findIndex((label) => {
    const lower = label.toLowerCase();
    return lower === name || lower.slice(0, 3) === name || (lower === "september" && name === "sept");
  });
  const year = Number(match[2]);
  if (month < 0 || year < 1000) return null;

  const from = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { range: { field: "taken", from, to }, label: `${months[month]} ${year}` };
}
