import DOMPurify from "dompurify";

export function escapeHtml(input: string): string {
    return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function sanitizeOutgoingHtml(input: string): string {
    return DOMPurify.sanitize(input, {
        ALLOWED_TAGS: ["div", "p", "br", "b", "strong", "em", "i", "u", "ul", "ol", "li", "span", "blockquote"],
        ALLOWED_ATTR: [],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
    });
}
