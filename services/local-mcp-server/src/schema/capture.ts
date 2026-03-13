import { randomUUID } from "node:crypto"

import { z } from "zod"

const MAX_TEXT_LENGTH = 100_000
const MAX_TITLE_LENGTH = 512
const MAX_URL_LENGTH = 2_048
const MAX_REFERRER_LENGTH = 2_048
const MAX_SOURCE_SESSION_LENGTH = 128

const trimAndCollapseWhitespace = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .trim()

const optionalTrimmed = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .trim()
    .transform((value) => value || "")
    .optional()
    .default("")

export const captureIngestSchema = z
  .object({
    title: z.string().min(1).max(MAX_TITLE_LENGTH).transform(trimAndCollapseWhitespace),
    url: z.url().max(MAX_URL_LENGTH),
    referrer: optionalTrimmed(MAX_REFERRER_LENGTH),
    bodyText: z.string().min(1).max(MAX_TEXT_LENGTH).transform(trimAndCollapseWhitespace),
    maxScrollPercentage: z.number().min(0).max(100).default(0),
    capturedAt: z.iso.datetime({ offset: true }).optional(),
    sourceSession: optionalTrimmed(MAX_SOURCE_SESSION_LENGTH)
  })
  .strict()

export type CaptureIngestInput = z.input<typeof captureIngestSchema>
export type CaptureIngest = z.output<typeof captureIngestSchema>

export const captureRecordSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(MAX_TITLE_LENGTH),
    url: z.url().max(MAX_URL_LENGTH),
    referrer: z.string().max(MAX_REFERRER_LENGTH),
    bodyText: z.string().min(1).max(MAX_TEXT_LENGTH),
    maxScrollPercentage: z.number().min(0).max(100),
    capturedAt: z.iso.datetime({ offset: true }),
    sourceSession: z.string().max(MAX_SOURCE_SESSION_LENGTH),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true })
  })
  .strict()

export type CaptureRecord = z.infer<typeof captureRecordSchema>

export const normalizeCaptureIngest = (input: CaptureIngestInput) =>
  captureIngestSchema.parse(input)

export const toCaptureRecord = (
  input: CaptureIngestInput,
  nowIso = new Date().toISOString()
): CaptureRecord => {
  const normalized = normalizeCaptureIngest(input)

  return captureRecordSchema.parse({
    id: randomUUID(),
    title: normalized.title,
    url: normalized.url,
    referrer: normalized.referrer,
    bodyText: normalized.bodyText,
    maxScrollPercentage: normalized.maxScrollPercentage,
    capturedAt: normalized.capturedAt ?? nowIso,
    sourceSession: normalized.sourceSession,
    createdAt: nowIso,
    updatedAt: nowIso
  })
}
