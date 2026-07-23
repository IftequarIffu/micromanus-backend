import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiPath = path.join(root, "api", "index.js");

const FOOTER = "\nmodule.exports = module.exports.default || module.exports;\n";

let source = fs.readFileSync(apiPath, "utf8");
if (!source.includes("module.exports = module.exports.default || module.exports")) {
  source += FOOTER;
  fs.writeFileSync(apiPath, source, "utf8");
}

const require = createRequire(import.meta.url);
delete require.cache[apiPath];
const exported = require(apiPath);

if (typeof exported !== "function") {
  console.error(
    "vercel-build: api/index.js must export a function, got",
    typeof exported,
    exported && typeof exported === "object" ? Object.keys(exported) : "",
  );
  process.exit(1);
}

console.log("vercel-build: ok — api/index.js exports a function handler");
