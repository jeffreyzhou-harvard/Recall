import { describe, expect, it } from "vitest";
import { PHONE_COUNTRIES } from "@/lib/phone/countries";
import { caretIndex, formatNational, isCompletePhone, parsePhoneInput, toE164 } from "@/lib/phone/format";

const us = PHONE_COUNTRIES.find((country) => country.iso === "US")!;
const gb = PHONE_COUNTRIES.find((country) => country.iso === "GB")!;

describe("phone formatting", () => {
  it("puts the United States first, then alphabetical names", () => {
    expect(PHONE_COUNTRIES[0]).toMatchObject({ iso: "US", name: "United States" });
    const names = PHONE_COUNTRIES.slice(1).map((country) => country.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("formats a US number as it is typed", () => {
    expect(formatNational("2", us)).toBe("(2");
    expect(formatNational("206", us)).toBe("(206");
    expect(formatNational("2063", us)).toBe("(206) 3");
    expect(formatNational("2063428", us)).toBe("(206) 342-8");
    expect(formatNational("2063428631", us)).toBe("(206) 342-8631");
    expect(formatNational("2071838750", gb)).toBe("207-183-8750");
  });

  it("builds E.164 from the selected country without asking the user to type +", () => {
    expect(toE164(us, "2063428631")).toBe("+12063428631");
    expect(toE164(gb, "2071838750")).toBe("+442071838750");
    expect(toE164(us, "")).toBe("");
  });

  it("accepts a pasted international or national number", () => {
    expect(parsePhoneInput("+1 (206) 342-8631")).toMatchObject({ country: { iso: "US" }, national: "2063428631" });
    expect(parsePhoneInput("206-342-8631", "US")).toMatchObject({ country: { iso: "US" }, national: "2063428631" });
    expect(parsePhoneInput("12063428631", "US")).toMatchObject({ national: "2063428631" });
    expect(parsePhoneInput("+442071838750")).toMatchObject({ country: { iso: "GB" }, national: "2071838750" });
  });

  it("keeps Canada selected for a shared +1 code", () => {
    expect(parsePhoneInput("+14165550123", "CA")).toMatchObject({ country: { iso: "CA" }, national: "4165550123" });
  });

  it("treats a 10-digit US number as complete and a partial one as not", () => {
    expect(isCompletePhone("+12063428631")).toBe(true);
    expect(isCompletePhone("+1206342")).toBe(false);
    expect(isCompletePhone("+442071838750")).toBe(true);
  });

  it("places the caret after the typed digit, not after a newly inserted mark", () => {
    expect(caretIndex("(206) 3", 4)).toBe(7);
    expect(caretIndex("(206) 342-8", 7)).toBe(11);
  });
});
