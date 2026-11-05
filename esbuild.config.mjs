import esbuild from "esbuild";
import process from "process";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  outfile: "main.js",
  format: "cjs",
  target: "es2020",
  logLevel: "info",
});
