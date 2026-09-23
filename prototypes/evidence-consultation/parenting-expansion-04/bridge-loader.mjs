import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaptFrozenModule } from "./frozen-adapter.mjs";
const directory = path.dirname(fileURLToPath(import.meta.url));
const virtual = new Map([["native-adapter.mjs", "adapter-loader.mjs"], ["runner-child.mjs", "runner-child.mjs"], ["verify.mts", "verify.mts"]]);
export async function resolve(specifier, context, nextResolve) {
  const url = specifier.startsWith("file:") ? new URL(specifier) :
    specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL) : null;
  if (url?.protocol === "file:" && path.dirname(fileURLToPath(url)) === directory && virtual.has(path.basename(fileURLToPath(url)))) {
    return { url: url.href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && path.dirname(fileURLToPath(url)) === directory) {
    const name = virtual.get(path.basename(fileURLToPath(url)));
    if (name) {
      let source = adaptFrozenModule(name);
      if (name.endsWith(".mts")) {
        const { transform } = await import("esbuild");
        source = (await transform(source, { loader: "ts", format: "esm", target: "node20" })).code;
      }
      return { format: "module", source, shortCircuit: true };
    }
  }
  return nextLoad(url, context);
}