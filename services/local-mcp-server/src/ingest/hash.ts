import { createHash } from "node:crypto"

const normalizeForHash = (input: string) =>
  input
    .replace(/\r\n/g, "\n")
    .trim()

export const computeContentHash = (bodyText: string) =>
  createHash("sha256").update(normalizeForHash(bodyText), "utf8").digest("hex")
