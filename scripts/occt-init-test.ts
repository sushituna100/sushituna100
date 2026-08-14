import { initOcct } from "../server/occt/init";

console.log("initializing OCCT WASM...");
const start = Date.now();
await initOcct();
console.log("OCCT ready in", Date.now() - start, "ms");
