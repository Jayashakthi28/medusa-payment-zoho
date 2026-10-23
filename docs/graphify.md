# Graphify knowledge graph

The repository includes a Graphify knowledge graph so a replacement developer or coding
agent can navigate the code and tests without rereading every file.

## Outputs

| File                                 | Purpose                                                                |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `graphify-out/graph.json`            | Typed nodes and edges for source, tests, scripts, examples, and config |
| `graphify-out/GRAPH_REPORT.md`       | God nodes, surprising connections, communities, suggested questions    |
| `graphify-out/manifest.json`         | Incremental-update manifest                                            |
| `graphify-out/.graphify_labels.json` | Curated human-readable community labels                                |
| `graphify-out/graph.html`            | Interactive graph (generated locally, not committed)                   |

The checked-in graph is **deterministic**: source, tests, scripts, examples, and
supported documentation are extracted structurally, without an LLM API key. Semantic
prose extraction is not required to maintain it; the documentation is also linked from
`docs/PROGRESS.md`.

## Query examples

```bash
graphify query "How does webhook signature verification reach authorizePayment?"
graphify path "handleZohoWebhook" "processPaymentWorkflow"
graphify explain "resolveZohoPaymentOptions"
graphify affected "ZohoPaymentProviderService"
graphify god-nodes --top 15
```

Use `--budget 1200` on query to cap output tokens.

## Refresh

After code changes:

```bash
graphify update .
graphify cluster-only . --no-label   # regenerates report with curated labels
```

The manifest makes `update` incremental. Do not delete `graphify-out/manifest.json`
unless you intend a full rebuild.

## Integrity

The audit report includes Graphify's health check. The generated report notes extraction
confidence; `EXTRACTED` means a direct AST edge, `INFERRED` means a semantic guess. Treat
`INFERRED` edges as navigation hints, not proof.

## Why deterministic

This project values reproducibility and does not require an API key to maintain its
graph. The extractor covers the provider, transport, signatures, browser helper, tests,
scripts, configuration, and supported docs, which are the files most likely to change.
Documentation changes remain easy to review directly and are linked from
`docs/PROGRESS.md`. The report records the commit it was built from; a later docs-only
commit does not invalidate the code graph.
