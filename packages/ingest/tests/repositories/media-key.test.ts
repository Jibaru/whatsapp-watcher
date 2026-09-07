import { describe, expect, it } from "bun:test";
import { mediaKey } from "../../src/repositories/s3-inbound-media.repository.js";

describe("mediaKey", () => {
  it("keeps the message id readable and adds the extension", () => {
    expect(mediaKey("wamid.HBgTUEUuMTYx", "image/jpeg")).toBe("inbound/wamid.HBgTUEUuMTYx.jpg");
    expect(mediaKey("wamid.abc", "audio/ogg")).toBe("inbound/wamid.abc.ogg");
  });

  it("neutralizes base64 characters that would nest or confuse the key", () => {
    expect(mediaKey("wamid.a/b+c=", "image/png")).toBe("inbound/wamid.a_b_c_.png");
  });

  it("omits the extension for an unknown type", () => {
    expect(mediaKey("wamid.abc", "application/x-weird")).toBe("inbound/wamid.abc");
    expect(mediaKey("wamid.abc")).toBe("inbound/wamid.abc");
  });
});
