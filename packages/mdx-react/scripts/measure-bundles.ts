import { measureBundles } from "./bundles.ts";

const measurements = await measureBundles();

console.log(JSON.stringify(measurements, null, 2));
