export const PAGE_CAPTURES_STORAGE_KEY = "surfrag:page-captures"
export const MAX_CAPTURE_HISTORY = 100

export type PageCaptureRecord = {
  id: string
  title: string
  url: string
  referrer: string
  bodyText: string
  maxScrollPercentage: number
  createdAt: string
  updatedAt: string
}
