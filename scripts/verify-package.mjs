#!/usr/bin/env node
/**
 * Verify the package exactly as npm consumers receive it.
 *
 * The script packs the repository, installs the tarball in a throwaway consumer,
 * and imports every public entry point with ESM and CommonJS. It uses only Node
 * built-ins so it can run before the repository has installed any dependencies.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..")
const EXPECTED_VERSION = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, "package.json"), "utf8")
).version
const FRAMEWORK_VERSION = "2.22.0"
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm"
const MAX_OUTPUT_LENGTH = 8_000

const CLIENT_EXPORTS = [
  "loadZohoPaymentsScript",
  "payWithZohoCheckout",
  "redirectToZohoHostedCheckout",
]

const ROOT_EXPORTS = [
  "ZohoPaymentProvider",
  "ZohoPaymentProviderService",
  "ZohoPaymentsClient",
  "formatAmountForZoho",
  "isValidZohoWebhookSignature",
]

const SERVER_VERIFIER_EXPORTS = [
  "assertValidZohoWebhookSignature",
  "isValidZohoHostedCheckoutSignature",
  "isValidZohoWebhookSignature",
  "isValidZohoWidgetResponseSignature",
  "parseZohoSignatureHeader",
]

class VerificationError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = "VerificationError"
  }
}

function tail(value, length = MAX_OUTPUT_LENGTH) {
  const text = value.trim()

  return text.length > length ? `…${text.slice(-length)}` : text
}

function npmEnvironment() {
  const environment = {
    ...process.env,
    npm_config_loglevel: "error",
    npm_config_update_notifier: "false",
  }

  // The consumer install is public. Do not pass publish credentials into npm
  // commands that do not need them.
  delete environment.NODE_AUTH_TOKEN
  delete environment.NPM_TOKEN

  return environment
}

function run(command, arguments_, options) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd,
    encoding: "utf8",
    env: npmEnvironment(),
    maxBuffer: 32 * 1024 * 1024,
  })

  if (result.error) {
    throw new VerificationError(
      `${options.label} could not start: ${result.error.message}`,
      { cause: result.error }
    )
  }

  if (result.status !== 0) {
    const output = tail([result.stdout, result.stderr].filter(Boolean).join("\n"))
    const suffix = output ? `\n\n${output}` : ""
    const reason =
      typeof result.signal === "string"
        ? `was terminated by ${result.signal}`
        : `exited with code ${String(result.status)}`

    throw new VerificationError(`${options.label} ${reason}.${suffix}`)
  }

  return result.stdout ?? ""
}

function parsePackOutput(output) {
  const parse = (value) => {
    try {
      return JSON.parse(value)
    } catch {
      return undefined
    }
  }

  const direct = parse(output)

  if (direct !== undefined) {
    return direct
  }

  // npm may prepend notices even with --json. Recover the JSON array from the
  // surrounding text, but fail loudly if no complete array is present.
  const start = output.indexOf("[")
  const end = output.lastIndexOf("]")

  if (start === -1 || end <= start) {
    throw new VerificationError(
      `npm pack did not return JSON. Output was:\n\n${tail(output)}`
    )
  }

  const recovered = parse(output.slice(start, end + 1))

  if (recovered === undefined) {
    throw new VerificationError(
      `npm pack returned malformed JSON. Output was:\n\n${tail(output)}`
    )
  }

  return recovered
}

function assertClientBundlePurity() {
  const forbidden = ["node:", "@medusajs/"]

  for (const entry of ["dist/client/index.js", "dist/client/index.cjs"]) {
    const source = readFileSync(join(REPOSITORY_ROOT, entry), "utf8")

    for (const token of forbidden) {
      if (source.includes(token)) {
        throw new VerificationError(
          `${entry} imports or references "${token}". The browser entry point must remain free of Node.js and Medusa server code.`
        )
      }
    }
  }
}

function packTarball() {
  assertClientBundlePurity()

  for (const entry of ["dist/client/index.js", "dist/server/index.js"]) {
    if (!existsSync(join(REPOSITORY_ROOT, entry))) {
      throw new VerificationError(
        `Build output "${entry}" is missing. Run "pnpm build" before verifying the package.`
      )
    }
  }

  console.log("Packing the repository with npm pack --json ...")
  const output = run(NPM_COMMAND, ["pack", "--json"], {
    cwd: REPOSITORY_ROOT,
    label: "npm pack",
  })
  const result = parsePackOutput(output)

  if (!Array.isArray(result) || result.length === 0) {
    throw new VerificationError("npm pack returned an empty result")
  }

  const pack = result[0]

  if (typeof pack?.filename !== "string" || pack.filename.length === 0) {
    throw new VerificationError("npm pack did not return a tarball filename")
  }

  if (pack.name !== "medusa-payment-zoho") {
    throw new VerificationError(
      `npm pack produced package "${String(pack.name)}", expected "medusa-payment-zoho"`
    )
  }

  if (pack.version !== EXPECTED_VERSION) {
    throw new VerificationError(
      `npm pack produced version ${String(pack.version)}, expected ${EXPECTED_VERSION}`
    )
  }

  const tarballPath = resolve(REPOSITORY_ROOT, pack.filename)

  if (!existsSync(tarballPath)) {
    throw new VerificationError(
      `npm pack reported "${pack.filename}" but the tarball does not exist at ${tarballPath}`
    )
  }

  console.log(`  Tarball: ${pack.filename}`)
  return tarballPath
}

function verifierSource() {
  return `import { createRequire } from "node:module"

const EXPECTED_VERSION = ${JSON.stringify(EXPECTED_VERSION)}
const CLIENT_EXPORTS = ${JSON.stringify(CLIENT_EXPORTS)}
const ROOT_EXPORTS = ${JSON.stringify(ROOT_EXPORTS)}
const SERVER_VERIFIER_EXPORTS = ${JSON.stringify(SERVER_VERIFIER_EXPORTS)}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertFunctions(moduleExports, names, label) {
  const missing = names.filter((name) => typeof moduleExports[name] !== "function")

  assert(
    missing.length === 0,
    \`\${label} is missing exported function(s): \${missing.join(", ")}\`
  )
}

function assertExports(moduleExports, names, label) {
  const missing = names.filter((name) => moduleExports[name] === undefined)

  assert(
    missing.length === 0,
    \`\${label} is missing export(s): \${missing.join(", ")}\`
  )
}

try {
  const rootEsm = await import("medusa-payment-zoho")
  assertExports(rootEsm, ROOT_EXPORTS, "ESM import of medusa-payment-zoho")

  const require = createRequire(import.meta.url)
  const rootCjs = require("medusa-payment-zoho")
  assertExports(rootCjs, ROOT_EXPORTS, "CJS require of medusa-payment-zoho")

  const clientEsm = await import("medusa-payment-zoho/client")
  assertFunctions(clientEsm, CLIENT_EXPORTS, "ESM import of medusa-payment-zoho/client")

  const clientCjs = require("medusa-payment-zoho/client")
  assertFunctions(clientCjs, CLIENT_EXPORTS, "CJS require of medusa-payment-zoho/client")

  const providerEsm = await import("medusa-payment-zoho/providers/zoho")
  assert(
    providerEsm.default !== undefined && providerEsm.default !== null,
    "ESM import of medusa-payment-zoho/providers/zoho has no default export"
  )

  const providerCjs = require("medusa-payment-zoho/providers/zoho")
  const providerCjsDefault = providerCjs.default ?? providerCjs
  assert(
    providerCjsDefault !== undefined && providerCjsDefault !== null,
    "CJS require of medusa-payment-zoho/providers/zoho has no usable export"
  )
  assert(
    providerCjsDefault === providerCjs.default,
    "CJS provider entry must expose the provider through both module.exports and .default"
  )

  const serverEsm = await import("medusa-payment-zoho/server")
  assertFunctions(
    serverEsm,
    SERVER_VERIFIER_EXPORTS,
    "ESM import of medusa-payment-zoho/server"
  )

  const packageJson = require("medusa-payment-zoho/package.json")
  assert(
    packageJson.version === EXPECTED_VERSION,
    \`medusa-payment-zoho/package.json has version \${JSON.stringify(packageJson.version)}, expected \${EXPECTED_VERSION}\`
  )

  console.log("  root (ESM + CJS): " + ROOT_EXPORTS.join(", "))
  console.log("  client (ESM): " + CLIENT_EXPORTS.join(", "))
  console.log("  client (CJS): " + CLIENT_EXPORTS.join(", "))
  console.log("  providers/zoho (ESM + CJS): default export")
  console.log("  server (ESM): " + SERVER_VERIFIER_EXPORTS.join(", "))
  console.log("  package.json version: " + packageJson.version)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error("Package verification failed: " + message)
  process.exitCode = 1
}
`
}

function verifyInstalledPackage(consumerDirectory) {
  run(NPM_COMMAND, ["init", "-y"], {
    cwd: consumerDirectory,
    label: "npm init",
  })

  const verifierFile = join(consumerDirectory, "verify-package.mjs")
  writeFileSync(verifierFile, verifierSource(), "utf8")

  const output = run(process.execPath, ["verify-package.mjs"], {
    cwd: consumerDirectory,
    label: "Installed package verification",
  })

  if (output.trim().length > 0) {
    console.log(output.trimEnd())
  }
}

function main() {
  let tarballPath
  let consumerDirectory

  try {
    tarballPath = packTarball()
    consumerDirectory = mkdtempSync(join(tmpdir(), "medusa-payment-zoho-verify-"))

    console.log(`\nCreating consumer in ${consumerDirectory} ...`)
    console.log(
      `Installing the tarball and @medusajs/framework@${FRAMEWORK_VERSION} (this can take a couple of minutes) ...`
    )

    run(
      NPM_COMMAND,
      [
        "install",
        tarballPath,
        `@medusajs/framework@${FRAMEWORK_VERSION}`,
        `@medusajs/types@${FRAMEWORK_VERSION}`,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--legacy-peer-deps",
      ],
      { cwd: consumerDirectory, label: "Consumer dependency install" }
    )

    console.log("\nVerifying exports from the installed package:")
    verifyInstalledPackage(consumerDirectory)
    console.log("\nPackage verification passed.")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\nPackage verification failed: ${message}`)
    process.exitCode = 1
  } finally {
    if (consumerDirectory !== undefined) {
      try {
        rmSync(consumerDirectory, { recursive: true, force: true })
      } catch (error) {
        console.error(
          `Warning: could not remove the temporary consumer directory ${consumerDirectory}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }

    if (tarballPath !== undefined) {
      try {
        rmSync(tarballPath, { force: true })
      } catch (error) {
        console.error(
          `Warning: could not remove the tarball ${tarballPath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
  }
}

if (!existsSync(join(REPOSITORY_ROOT, "package.json"))) {
  console.error(
    `Package verification failed: could not find package.json in ${REPOSITORY_ROOT}`
  )
  process.exitCode = 1
} else {
  main()
}
