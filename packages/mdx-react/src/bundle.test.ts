// @vitest-environment node
import { expect, it } from "vitest";

import { measureBundles } from "../scripts/bundles.ts";

it("keeps optional integrations outside streaming bundles", async () => {
  const bundles = await measureBundles();
  const budgets = { core: 165_000, react: 175_000, snapshot: 18_000 };

  for (const bundle of bundles) {
    expect(bundle.gzipBytes).toBeLessThan(budgets[bundle.entry]);
    expect(bundle.inputs.join("\n")).not.toMatch(
      /node_modules\/(?:shiki|@shikijs|unified|vfile)\//u,
    );
  }

  const snapshot = bundles.find((bundle) => bundle.entry === "snapshot");
  expect(snapshot?.inputs.join("\n")).not.toMatch(
    /(?:\/parser\/|\/acorn\/|\/yaml\/|\/smol-toml\/)/u,
  );
}, 20_000);
