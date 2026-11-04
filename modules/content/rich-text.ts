import sanitizeHtml from "sanitize-html";

/**
 * Course rich text is authored by staff and shown to learners, so it is
 * sanitised on write and again on render. The allowlist is intentionally small:
 * formatting, headings, lists, links, and code. Scripts, styles, iframes,
 * event handlers, and inline URLs outside http(s)/mailto are removed.
 */

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "h2",
    "h3",
    "h4",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "a",
    "hr",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow noopener noreferrer" }),
  },
};

export const RICH_TEXT_MAX_LENGTH = 40_000;

/** Sanitised HTML, safe to store and to render. Empty input becomes `null`. */
export function cleanRichText(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = sanitizeHtml(input, OPTIONS).trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Text-only view for previews and search. Markup is dropped, entities decoded
 * to their plain characters, and whitespace collapsed.
 */
export function richTextToPlain(input: string | null | undefined, maxLength = 240): string {
  if (!input) return "";
  const plain = sanitizeHtml(
    // Block boundaries become spaces first, otherwise "<h2>A</h2><p>B</p>"
    // collapses into "AB".
    input.replace(/<\/(p|h[1-6]|li|blockquote|pre|div|tr|td|th)>/gi, " </$1>"),
    { allowedTags: [], allowedAttributes: {} },
  )
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain;
}
