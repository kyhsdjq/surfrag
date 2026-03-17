import * as lancedb from "@lancedb/lancedb"

const DEFAULT_TABLE_NAME = "captures"

export type VectorRecord = {
  vector: number[]
  capture_id: string
}

export type VectorSearchResult = {
  capture_id: string
  _distance?: number
}

export type LanceDBConfig = {
  path: string
  tableName?: string
  dimension: number
}

export type LanceDBClient = {
  add(records: VectorRecord[]): Promise<void>
  vectorSearch(queryVector: number[], limit?: number): Promise<VectorSearchResult[]>
}

/**
 * Connect to LanceDB and ensure the captures table exists.
 * Creates the table with an initial record if it does not exist.
 */
export async function bootstrapLanceDB(
  config: LanceDBConfig
): Promise<LanceDBClient> {
  const { path, tableName = DEFAULT_TABLE_NAME, dimension } = config
  const db = await lancedb.connect(path)
  const names = await db.tableNames()

  let table: lancedb.Table
  if (names.includes(tableName)) {
    table = await db.openTable(tableName)
  } else {
    const placeholderVector = new Array<number>(dimension).fill(0)
    table = await db.createTable(
      tableName,
      [{ vector: placeholderVector, capture_id: "__placeholder__" }],
      { mode: "create", existOk: false }
    )
    await table.delete("capture_id = '__placeholder__'")
  }

  return {
    async add(records: VectorRecord[]) {
      if (records.length === 0) return
      await table.add(records, { mode: "append" })
    },

    async vectorSearch(
      queryVector: number[],
      limit = 10
    ): Promise<VectorSearchResult[]> {
      const results = await table
        .vectorSearch(queryVector)
        .limit(limit)
        .select(["capture_id", "_distance"])
        .toArray()

      return results as VectorSearchResult[]
    }
  }
}
