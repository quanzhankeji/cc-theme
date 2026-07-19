#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { writeCompiledThemeFamily } from "./compiler.mjs";

export async function runThemeCompilerCli(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write("Usage: node app/packages/shared-core/cli.mjs <unified-theme.json> <compile-context.json> <output-directory> [adapter-id]\n");
    return 0;
  }
  if (argv.length < 3 || argv.length > 4) throw new Error("Expected unified-theme JSON, Adapter compile-context JSON, an output directory, and an optional Adapter id");
  const [inputValue, contextValue, outputValue, adapterId] = argv;
  const [inputFile, contextFile, outputDirectory] = [inputValue, contextValue, outputValue].map((value) => path.resolve(value));
  const source = JSON.parse(await readFile(inputFile, "utf8"));
  const context = JSON.parse(await readFile(contextFile, "utf8"));
  const result = await writeCompiledThemeFamily(source, context, outputDirectory, {
    ...(adapterId === undefined ? {} : { targetAdapterIds: [adapterId] }),
  });
  process.stdout.write(`${JSON.stringify({ ok: true, files: result.files, applyAvailability: result.applyAvailability })}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runThemeCompilerCli().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  });
}
