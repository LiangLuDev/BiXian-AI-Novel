import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";

const root = process.cwd();
const staticDir = path.join(root, "bixian", "static");
const distDir = path.join(staticDir, "dist");

const sources = [
  "icons.jsx",
  "api.jsx",
  "chrome.jsx",
  "tweaks.jsx",
  "screens/home.jsx",
  "screens/progress.jsx",
  "screens/reader.jsx",
  "screens/outline.jsx",
  "screens/character.jsx",
  "app.jsx",
];

const input = (
  await Promise.all(
    sources.map(async (file) => {
      const source = await readFile(path.join(staticDir, file), "utf8");
      return `\n/* ${file} */\n${source}`;
    })
  )
).join("\n");

const result = await transform(input, {
  loader: "jsx",
  jsx: "transform",
  format: "iife",
  globalName: "BixianAssistant",
  minify: true,
  sourcemap: false,
  target: ["es2018"],
});

await mkdir(distDir, { recursive: true });
await writeFile(path.join(distDir, "app.js"), result.code, "utf8");
console.log(`Built ${path.relative(root, path.join(distDir, "app.js"))}`);
