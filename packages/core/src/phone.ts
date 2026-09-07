import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

const ISO_COUNTRY = /^[A-Z]{2}$/;

/**
 * WhatsApp is inconsistent: some numbers arrive with the country prefix and some without.
 * A region hint resolves both, so callers should pass one whenever they have it.
 */
export class PhoneNumber {
  private constructor(
    readonly e164: string,
    readonly country: string | undefined,
  ) {}

  static parse(raw: string, countryHint?: string): PhoneNumber | undefined {
    const hint = countryHint?.trim().toUpperCase();
    const region = hint !== undefined && ISO_COUNTRY.test(hint) ? (hint as CountryCode) : undefined;
    const parsed = parsePhoneNumberFromString(raw.trim(), region);

    if (parsed === undefined || !parsed.isValid()) {
      return undefined;
    }

    return new PhoneNumber(parsed.number, parsed.country);
  }
}
