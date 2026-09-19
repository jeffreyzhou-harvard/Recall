import { describe, expect, it } from "vitest";
import { parseCalendar, parseContacts } from "@/lib/recall-preview/imports";

describe("caregiver local import previews", () => {
  it("reads quoted CSV names without approving contacts automatically", () => {
    expect(parseContacts('Name,Phone,Relationship\n"Patel, Maya",5550100,Daughter', "csv")).toEqual([
      { id: "contact-0", name: "Patel, Maya", phone: "5550100", relationship: "Daughter", selected: false },
    ]);
  });
  it("unfolds vCard text and reads a typed phone field", () => {
    expect(parseContacts("BEGIN:VCARD\r\nFN:Maya\r\n Patel\r\nTEL;TYPE=CELL:5550100\r\nEND:VCARD", "vcf")[0]).toMatchObject({ name: "MayaPatel", phone: "5550100", selected: false });
  });
  it("rejects missing headers and unfinished quoted CSV fields", () => {
    expect(() => parseContacts("Other\nMaya", "csv")).toThrow("Name column");
    expect(() => parseContacts('Name\n"Maya', "csv")).toThrow("unfinished");
  });
  it("reads event dates as listed without inventing an approval or timezone conversion", () => {
    expect(parseCalendar("BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:visit\nSUMMARY:Lunch with Maya\nDTSTART;TZID=America/New_York:20260920T120000\nEND:VEVENT\nEND:VCALENDAR")).toEqual([
      { id: "visit", title: "Lunch with Maya", date: "2026-09-20 · 12:00", selected: false },
    ]);
  });
  it("rejects empty calendars and deduplicates event UIDs", () => {
    expect(() => parseCalendar("BEGIN:VCALENDAR\nEND:VCALENDAR")).toThrow("No dated events");
    const event = "BEGIN:VEVENT\nUID:visit\nSUMMARY:Lunch\nDTSTART;VALUE=DATE:20260920\nEND:VEVENT\n";
    expect(parseCalendar(event + event)).toHaveLength(1);
  });
});
