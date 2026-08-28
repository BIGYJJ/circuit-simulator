import { describe, expect, it } from "vitest";
import { BUNDLED_MODEL_MANIFEST, CURRENT_BUNDLED_MODEL_KEYS, validateBundledModelManifest } from "./bundled-models";

describe("bundled model compatibility ledger", () => {
  it("keeps immutable source/hash entries and selects a separate current key", async () => {
    await expect(validateBundledModelManifest()).resolves.toMatchObject({ ok: true });
    expect(BUNDLED_MODEL_MANIFEST.some((entry) => entry.id === CURRENT_BUNDLED_MODEL_KEYS.ledDiode)).toBe(true);
    expect(BUNDLED_MODEL_MANIFEST.every((entry) => entry.origin === "bundled")).toBe(true);
  });
});
