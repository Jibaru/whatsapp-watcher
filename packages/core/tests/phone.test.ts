import { describe, expect, it } from "bun:test";
import { PhoneNumber } from "../src/phone.js";

describe("PhoneNumber", () => {
  it("adds the country prefix a national number is missing", () => {
    const phone = PhoneNumber.parse("982705024", "PE");

    expect(phone?.e164).toBe("+51982705024");
    expect(phone?.country).toBe("PE");
  });

  it("keeps a number that already carries its prefix", () => {
    expect(PhoneNumber.parse("51982705024", "PE")?.e164).toBe("+51982705024");
    expect(PhoneNumber.parse("16315551181", "US")?.e164).toBe("+16315551181");
    expect(PhoneNumber.parse("+51982705024")?.e164).toBe("+51982705024");
  });

  it("is case insensitive with the hint", () => {
    expect(PhoneNumber.parse("982705024", "pe")?.e164).toBe("+51982705024");
  });

  it("returns undefined instead of guessing", () => {
    expect(PhoneNumber.parse("982705024")).toBeUndefined();
    expect(PhoneNumber.parse("982705024", "XX")).toBeUndefined();
    expect(PhoneNumber.parse("982705024", "PE.1618166519838886")).toBeUndefined();
    expect(PhoneNumber.parse("not a phone", "PE")).toBeUndefined();
    expect(PhoneNumber.parse("123", "PE")).toBeUndefined();
  });
});
