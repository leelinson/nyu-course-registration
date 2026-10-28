/** "09:30" -> "9:30am", "13:00" -> "1pm". */
export function formatTime(hhmm: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
}

export function formatMeeting(m: { days: string; start: string | null; end: string | null }): string {
  if (!m.start) return m.days || "TBA";
  return `${m.days} ${formatTime(m.start)} to ${formatTime(m.end)}`;
}
