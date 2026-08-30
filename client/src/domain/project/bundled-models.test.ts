import { describe, expect, it } from "vitest";
import {
  CURRENT_BUNDLED_MODEL_KEYS,
  bundledManifestForValidation,
  bundledModelDefinition,
  getBundledModelManifest,
} from "./bundled-models";
import { parseAndValidateSpiceSource, validateProjectModels } from "../../simulation/spice-source-parser";
import { dividerProjectFixture } from "../../../../tests/fixtures/circuits/projects";

describe("bundled model ledger", () => {
  it("keeps old and current LED entries and rejects a forged bundled claim", async () => {
    const manifest = await getBundledModelManifest();
    const old = manifest.find(item => item.modelId === "dled-v1");
    const current = manifest.find(item => item.modelId === CURRENT_BUNDLED_MODEL_KEYS.led);
    expect(old).toBeTruthy();
    expect(current?.modelId).toBe("dled-v2");
    expect(old?.source).not.toBe(current?.source);

    const parsedOld = await parseAndValidateSpiceSource(old!.source, "bundled-model", "opaque-model");
    const parsedNew = await parseAndValidateSpiceSource(current!.source, "bundled-model", "opaque-model");
    expect(parsedOld.ok && parsedOld.value.sha256).toBe(old!.sha256);
    expect(parsedNew.ok && parsedNew.value.sha256).toBe(current!.sha256);

    const forged = await bundledModelDefinition("dled-v2");
    const project = dividerProjectFixture();
    project.models = [
      {
        ...forged!,
        origin: "bundled",
        source: ".model FAKE D(IS=1e-9)\n",
        sha256: "0".repeat(64),
      },
    ];
    const result = await validateProjectModels(project, "bundled-model", await bundledManifestForValidation());
    expect(result.ok).toBe(false);
  });
});
