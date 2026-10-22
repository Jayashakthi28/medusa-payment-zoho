import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "providers/zoho/index": "src/providers/zoho/index.ts",
    "client/index": "src/client/index.ts",
    "server/index": "src/server/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  platform: "neutral",
  splitting: false,
  treeshake: true,
  external: [/^@medusajs\//, /^node:/],
})
