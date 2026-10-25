import sanitizeHtml from 'sanitize-html'
const UPLOAD_URL_RE = /^\/api\/uploads\/([A-Za-z0-9_-]+\.[A-Za-z0-9]+)$/

export function extractUploadFilenames(html: string | null | undefined): string[] {
  if (!html) return []
  const out = new Set<string>()
  // Parse attributes rather than arbitrary text. This decodes HTML entities and
  // does not mistake code examples or an unrelated external URL for a grant.
  sanitizeHtml(html, { allowedTags: [], allowedAttributes: {}, transformTags: {
    '*': (tagName, attribs) => {
      for (const value of [attribs.src, attribs.href]) {
        if (!value) continue
        const match = value.match(UPLOAD_URL_RE)
        if (match) out.add(match[1])
      }
      return { tagName, attribs }
    },
  } })
  return [...out]
}
