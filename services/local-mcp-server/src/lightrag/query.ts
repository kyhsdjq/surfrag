export type LightRAGQueryOptions = {
  query: string;
  mode?: "naive" | "local" | "global" | "hybrid" | "mix";
  limit?: number;
};

export type LightRAGReference = {
  reference_id: string;
  file_path: string;
};

export type LightRAGQueryResult = {
  response: string;
  references?: LightRAGReference[];
  query_mode: string;
};

export type LightRAGQueryError = {
  error: string;
};

/**
 * Query LightRAG's /query endpoint (Phase 3.4).
 * @throws {LightRAGQueryError} When the request fails or returns non-2xx
 */
export async function queryLightRAG(
  options: LightRAGQueryOptions,
  baseUrl: string,
  apiKey?: string | null
): Promise<LightRAGQueryResult> {
  const url = baseUrl.replace(/\/$/, "") + "/query";

  const body = {
    query: options.query.trim(),
    mode: options.mode ?? "mix",
    chunk_top_k: options.limit ?? 10,
    include_references: true
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (apiKey?.trim()) {
    headers["X-API-Key"] = apiKey.trim();
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data: { response?: string; references?: LightRAGReference[]; detail?: string } | undefined;
  try {
    data = text ? (JSON.parse(text) as { response?: string; references?: LightRAGReference[]; detail?: string }) : undefined;
  } catch {
    // Non-JSON response
  }

  if (!res.ok) {
    const fallback = typeof data === "object" && data !== null ? JSON.stringify(data) : text;
    const message = (data?.detail ?? fallback) || res.statusText;
    throw { error: `LightRAG query failed (${res.status}): ${String(message).slice(0, 300)}` } as LightRAGQueryError;
  }

  return {
    response: (data?.response ?? ""),
    references: (data?.references ?? []),
    query_mode: body.mode
  };
}
