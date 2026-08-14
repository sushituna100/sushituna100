/**
 * One-time OpenCascade WASM initialization for the (experimental, server-side
 * only) B-rep evaluator spike. See CLAUDE.md "B-rep migration" for status.
 *
 * The Emscripten-generated loader (replicad-opencascadejs) was built assuming
 * a CommonJS host and references the bare `__dirname` global to locate its
 * .wasm file — which doesn't exist under Node's ESM loader (this project is
 * "type": "module"). We polyfill it before invoking the factory rather than
 * patch the generated file.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setOC } from "replicad";

let ocReady: Promise<void> | null = null;

export function initOcct(): Promise<void> {
  if (!ocReady) {
    ocReady = (async () => {
      const pkgDir = path.dirname(fileURLToPath(await import.meta.resolve("replicad-opencascadejs/package.json")));
      (globalThis as unknown as { __dirname?: string }).__dirname = path.join(pkgDir, "src");
      const opencascade = (await import("replicad-opencascadejs/src/replicad_single.js")).default;
      const oc = await opencascade();
      setOC(oc);
    })();
  }
  return ocReady;
}
