import { countryByIso, DEFAULT_PHONE_COUNTRY, isNanp, PHONE_COUNTRIES, type PhoneCountry } from "./countries";

export const E164 = /^\+[1-9]\d{6,14}$/;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function nationalLimit(country: PhoneCountry): number {
  return isNanp(country) ? 10 : Math.max(4, 15 - country.dial.length);
}

export function formatNational(digits: string, country: PhoneCountry): string {
  const clipped = digits.slice(0, nationalLimit(country));
  if (isNanp(country)) {
    const area = clipped.slice(0, 3);
    const mid = clipped.slice(3, 6);
    const last = clipped.slice(6, 10);
    if (clipped.length === 0) return "";
    if (clipped.length <= 3) return `(${area}`;
    if (clipped.length <= 6) return `(${area}) ${mid}`;
    return `(${area}) ${mid}-${last}`;
  }
  const chunks: string[] = [];
  let rest = clipped;
  while (rest.length > 4) {
    chunks.push(rest.slice(0, 3));
    rest = rest.slice(3);
  }
  if (rest) chunks.push(rest);
  return chunks.join("-");
}

export function toE164(country: PhoneCountry, national: string): string {
  const digits = digitsOnly(national).slice(0, nationalLimit(country));
  return digits ? `+${country.dial}${digits}` : "";
}

export function isCompletePhone(value: string, country = countryFromE164(value)): boolean {
  if (!E164.test(value)) return false;
  if (!country) return E164.test(value);
  const national = value.slice(1 + country.dial.length);
  return isNanp(country) ? national.length === 10 : E164.test(value);
}

export function countryFromE164(value: string, preferredIso?: string): PhoneCountry | null {
  const digits = digitsOnly(value);
  if (!digits) return null;
  const preferred = preferredIso ? countryByIso(preferredIso) : null;
  if (preferred && digits.startsWith(preferred.dial)) return preferred;
  const matches = PHONE_COUNTRIES.filter((country) => digits.startsWith(country.dial)).sort((a, b) => b.dial.length - a.dial.length);
  if (matches.length === 0) return null;
  if (matches[0].dial === "1") return matches.find((country) => country.iso === "US") ?? matches[0];
  if (matches[0].dial === "7") return matches.find((country) => country.iso === "RU") ?? matches[0];
  return matches[0];
}

export function nationalFromE164(value: string, country: PhoneCountry): string {
  const digits = digitsOnly(value);
  return digits.startsWith(country.dial) ? digits.slice(country.dial.length).slice(0, nationalLimit(country)) : digits.slice(0, nationalLimit(country));
}

/** Accept a paste or typed string: keep the current country unless a leading + names another. */
export function parsePhoneInput(raw: string, preferredIso = DEFAULT_PHONE_COUNTRY): { country: PhoneCountry; national: string } {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) {
    const country = countryFromE164(trimmed, preferredIso) ?? countryByIso(preferredIso);
    return { country, national: nationalFromE164(trimmed, country) };
  }
  const country = countryByIso(preferredIso);
  let national = digitsOnly(trimmed);
  if (isNanp(country) && national.length === 11 && national.startsWith("1")) national = national.slice(1);
  if (!isNanp(country) && national.startsWith(country.dial) && national.length > country.dial.length + 3) {
    national = national.slice(country.dial.length);
  }
  return { country, national: national.slice(0, nationalLimit(country)) };
}

export function caretIndex(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      seen += 1;
      if (seen === digitsBefore) return i + 1;
    }
  }
  return formatted.length;
}
