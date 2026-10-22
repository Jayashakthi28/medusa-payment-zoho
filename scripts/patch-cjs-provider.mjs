#!/usr/bin/env node
/**
 * Make the CommonJS provider entry work both as a direct module export and through
 * the `default` property emitted by tsup.
 *
 * Medusa's loader accepts the resolved module directly, while TypeScript CJS consumers
 * and some bundlers read `.default`. Exposing both avoids a runtime/type mismatch.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const providerFile = resolve(repositoryRoot, "dist/providers/zoho/index.cjs")
const marker = "module.exports.default = module.exports"

const source = readFileSync(providerFile, "utf8")

if (source.includes(marker)) {
  process.exit(0)
}

if (!source.includes("module.exports =")) {
  console.error(`Cannot patch ${providerFile}: expected a CommonJS module export.`)
  process.exit(1)
}

const lines = source.trimEnd().split("\n")
const sourceMapLine = [...lines]
  .reverse()
  .find((line) => line.startsWith("//# sourceMappingURL="))
const code = lines.filter((line) => !line.startsWith("//# sourceMappingURL="))

writeFileSync(
  providerFile,
  `${code.join("\n")}\n${marker}\n${sourceMapLine ?? ""}\n`,
  "utf8"
)
