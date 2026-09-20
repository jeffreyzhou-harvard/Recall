import { describe, expect, it } from "vitest";
import { emptySetup, parseCalendar, parseContacts, reviseSetup, setupValidationError, type SetupSelections } from "@/lib/recall-preview/imports";

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

  const agreedSetup: SetupSelections = {
    ...emptySetup,
    contacts: [{ id: "maya", name: "Maya", phone: "", relationship: "Daughter", selected: true }],
    days: ["Monday"], agreed: true,
  };
  it("requires a fresh agreement after any change to selected sources, permissions, or calling times", () => {
    expect(setupValidationError(agreedSetup)).toBeUndefined();
    const changes: Partial<Omit<SetupSelections, "agreed">>[] = [
      { photos: [] }, { samplePhotos: [] }, { contacts: [] }, { events: [] },
      { permissions: { ...emptySetup.permissions, dates: true } }, { days: ["Friday"] },
      { start: "11:00" }, { end: "13:00" },
    ];
    for (const change of changes) expect(reviseSetup(agreedSetup, change).agreed).toBe(false);
    expect(agreedSetup.agreed).toBe(true);
  });
  it("does not treat an imported contact or a displayed time as agreement", () => {
    expect(setupValidationError({ ...agreedSetup, contacts: parseContacts("Name\nMaya", "csv") })).toContain("approved person");
    expect(setupValidationError({ ...agreedSetup, days: [] })).toContain("calling day");
    expect(setupValidationError({ ...agreedSetup, start: "" })).toContain("end time");
    expect(setupValidationError({ ...agreedSetup, end: "25:00" })).toContain("end time");
    expect(setupValidationError({ ...agreedSetup, end: "09:00" })).toContain("end time");
    expect(setupValidationError({ ...agreedSetup, agreed: false })).toContain("confirm your agreement");
  });
});
