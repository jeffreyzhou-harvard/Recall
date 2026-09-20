"use client";

import { useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { countryByIso, countryFlag, DEFAULT_PHONE_COUNTRY, isNanp, PHONE_COUNTRIES } from "@/lib/phone/countries";
import { caretIndex, formatNational, parsePhoneInput, toE164 } from "@/lib/phone/format";

export function PhoneField({
  value,
  onChange,
  required = false,
  disabled = false,
  describedBy,
}: {
  value: string;
  onChange: (e164: string) => void;
  required?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const caretDigits = useRef<number | null>(null);
  const [iso, setIso] = useState(() => parsePhoneInput(value, DEFAULT_PHONE_COUNTRY).country.iso);
  const country = countryByIso(iso);
  const national = value ? parsePhoneInput(value, iso).national : "";
  const formatted = formatNational(national, country);

  useLayoutEffect(() => {
    const field = input.current;
    const digits = caretDigits.current;
    if (!field || digits == null) return;
    const next = caretIndex(formatted, digits);
    field.setSelectionRange(next, next);
    caretDigits.current = null;
  }, [formatted]);

  function emit(nextIso: string, nextNational: string) {
    setIso(nextIso);
    onChange(toE164(countryByIso(nextIso), nextNational));
  }

  function onNumberChange(event: ChangeEvent<HTMLInputElement>) {
    const start = event.target.selectionStart ?? event.target.value.length;
    caretDigits.current = event.target.value.slice(0, start).replace(/\D/g, "").length;
    const next = parsePhoneInput(event.target.value, iso);
    emit(next.country.iso, next.national);
  }

  return (
    <div className="live-setup-phone">
      <span className="live-setup-phone-heading" id="setup-phone-label">Their phone number</span>
      <div className="live-setup-phone-controls">
        <div className="live-setup-phone-country">
          <label htmlFor="setup-phone-country">Country</label>
          <select
            id="setup-phone-country"
            value={iso}
            disabled={disabled}
            aria-describedby={describedBy}
            onChange={(event) => emit(event.target.value, national)}
          >
            {PHONE_COUNTRIES.map((item) => (
              <option key={item.iso} value={item.iso}>
                {countryFlag(item.iso)} {item.name} (+{item.dial})
              </option>
            ))}
          </select>
        </div>
        <div className="live-setup-phone-number">
          <label htmlFor="setup-phone-number">Number</label>
          <span className="live-setup-phone-number-row">
            <span className="live-setup-phone-code" aria-hidden="true">+{country.dial}</span>
            <input
              id="setup-phone-number"
              ref={input}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={formatted}
              disabled={disabled}
              required={required}
              placeholder={isNanp(country) ? "(555) 555-0100" : "555-555-0100"}
              aria-describedby={describedBy}
              onChange={onNumberChange}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
