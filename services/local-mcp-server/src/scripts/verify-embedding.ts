/**
 * Verification script for Phase 2.1/2.2: GLM embed → LanceDB add → vectorSearch.
 * Run: pnpm run verify:embedding
 *
 * Requires API_KEY (or ZHIPU_API_KEY) and VECTOR_DB_PATH in .env.
 */
import "dotenv/config"
import path from "node:path"

import { getEmbeddingProvider } from "../embedding/index.js"
import { bootstrapLanceDB } from "../vector/index.js"

const TEST_CAPTURE_ID = "verify-test-001"
const VECTOR_DB_PATH =
  path.resolve(
    process.cwd(),
    process.env.VECTOR_DB_PATH?.trim() || "./data/lancedb"
  )

async function main() {
  console.log("Phase 2.1/2.2 verification: GLM embed → LanceDB add → vectorSearch\n")

  const provider = getEmbeddingProvider()
  console.log(`Embedding provider: ${provider.name}, dimension: ${provider.dimension}`)

  const text = "Machine learning and neural networks"
  console.log(`Embedding: "${text}"`)
  const vector = await provider.embed(text)
  console.log(`  → vector length: ${vector.length}`)

  const lancedb = await bootstrapLanceDB({
    path: VECTOR_DB_PATH,
    tableName: "capture_vectors",
    dimension: provider.dimension
  })
  console.log(`LanceDB connected: ${VECTOR_DB_PATH}`)

  await lancedb.add([{ vector, capture_id: TEST_CAPTURE_ID, chunk_index: 0 }])
  console.log(`Added 1 record (capture_id: ${TEST_CAPTURE_ID})`)

  const results = await lancedb.vectorSearch(vector, 5)
  console.log(`Vector search (top 5): ${results.length} results`)
  for (const r of results) {
    console.log(
      `  - capture_id: ${r.capture_id}, chunk_index: ${r.chunk_index}, _distance: ${r._distance?.toFixed(4)}`
    )
  }

  console.log("\n✓ Phase 2.1/2.2 verification passed")
}

main().catch((err) => {
  console.error("Verification failed:", err)
  process.exit(1)
})
