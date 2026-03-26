const stripTrailingSlash = (pathname: string) => {
  if (pathname === "/") {
    return pathname
  }
  return pathname.replace(/\/+$/g, "") || "/"
}

export const canonicalizeCaptureUrl = (rawUrl: string) => {
  const trimmed = rawUrl.trim()

  try {
    const parsed = new URL(trimmed)
    parsed.hash = ""
    parsed.protocol = parsed.protocol.toLowerCase()
    parsed.hostname = parsed.hostname.toLowerCase()

    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = ""
    }

    parsed.pathname = stripTrailingSlash(parsed.pathname || "/")
    return parsed.toString()
  } catch {
    return trimmed
  }
}
