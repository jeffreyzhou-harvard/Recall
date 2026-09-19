/** Local-only import previews. No network, graph writes, identity inference, or scheduling. */
export type SetupContact = { id: string; name: string; phone: string; relationship: string; selected: boolean };
export type SetupEvent = { id: string; title: string; date: string; selected: boolean };
export type SetupSelections = {
  photos: File[]; contacts: SetupContact[]; events: SetupEvent[];
  permissions: { faces: boolean; places: boolean; dates: boolean; themes: boolean };
  days: string[]; start: string; end: string; agreed: boolean;
};
export const emptySetup: SetupSelections = {
  photos: [], contacts: [], events: [], permissions: { faces: false, places: false, dates: false, themes: false },
  days: [], start: "10:00", end: "12:00", agreed: false,
};

function unfolded(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}
function plain(text: string) {
  return text.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}
function field(block: string, name: string) {
  const line = block.split("\n").find((entry) => new RegExp("^" + name + "(?:;[^:]*)?:", "i").test(entry));
  return line ? plain(line.slice(line.indexOf(":") + 1)) : "";
}
function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === "," || char === "\n")) {
      row.push(cell.trim()); cell = "";
      if (char === "\n") { rows.push(row); row = []; }
    } else if (char !== "\r") cell += char;
  }
  if (quoted) throw new Error("A quoted field is unfinished. Check the CSV file and try uploading it again.");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
export function parseContacts(text: string, format: "vcf" | "csv"): SetupContact[] {
  if (text.length > 1_000_000) throw new Error("Choose a contacts file smaller than 1 MB.");
  let items: { name: string; phone: string; relationship: string }[];
  if (format === "vcf") {
    items = unfolded(text).split(/BEGIN:VCARD/i).slice(1).map((block) => ({
      name: field(block, "FN"), phone: field(block, "TEL"), relationship: "",
    }));
  } else {
    const [header = [], ...rows] = csvRows(text.replace(/^\uFEFF/, ""));
    const find = (...names: string[]) => header.findIndex((value) => names.includes(value.toLowerCase()));
    const name = find("name", "full name"), phone = find("phone", "telephone"), relation = find("relationship", "relation");
    if (name < 0) throw new Error("Add a Name column. You can also include Phone and Relationship columns.");
    items = rows.map((row) => ({ name: row[name] ?? "", phone: row[phone] ?? "", relationship: row[relation] ?? "" }));
  }
  const unique = [...new Map(items.filter((item) => item.name).map((item) => [item.name + "|" + item.phone, item])).values()];
  if (!unique.length) throw new Error("No named contacts were found. Choose a vCard or a CSV with a Name column.");
  if (unique.length > 200) throw new Error("Choose a smaller selection of up to 200 contacts.");
  return unique.map((item, index) => ({ ...item, id: "contact-" + index, selected: false }));
}

export function parseCalendar(text: string): SetupEvent[] {
  if (text.length > 1_000_000) throw new Error("Choose a calendar file smaller than 1 MB.");
  const events = unfolded(text).split(/BEGIN:VEVENT/i).slice(1).map((block, index) => {
    const raw = field(block, "DTSTART");
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(raw);
    const date = match ? match[1] + "-" + match[2] + "-" + match[3] + (match[4] ? " · " + match[4] + ":" + match[5] : "") : "";
    return { id: field(block, "UID") || "event-" + index, title: field(block, "SUMMARY"), date, selected: false };
  }).filter((event) => event.title && event.date);
  const unique = [...new Map(events.map((event) => [event.id, event])).values()];
  if (!unique.length) throw new Error("No dated events were found. Choose an .ics calendar file with named events.");
  if (unique.length > 200) throw new Error("Choose a smaller calendar export with up to 200 events.");
  return unique;
}
