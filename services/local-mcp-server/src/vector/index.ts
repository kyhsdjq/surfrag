export {
  bootstrapLanceDB,
  type LanceDBClient,
  type LanceDBConfig,
  type VectorRecord,
  type VectorSearchResult
} from "./lancedb.js"
export {
  bootstrapVectorIfEnabled,
  canBootstrapVectorIndexing,
  type VectorBootstrapResult
} from "./bootstrap.js"
