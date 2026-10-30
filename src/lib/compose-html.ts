import DOMPurify from "dompurify";

export function escapeHtml(input: string): string {
    return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function sanitizeOutgoingHtml(input: string): string {
    const clean = DOMPurify.sanitize(input, {
        ALLOWED_TAGS: ["div", "p", "br", "b", "strong", "em", "i", "u", "ul", "ol", "li", "span", "blockquote", "img"],
        ALLOWED_ATTR: ["src", "alt"],
        ADD_DATA_URI_TAGS: ["img"],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
    });
    const document = new DOMParser().parseFromString(`<main>${clean}</main>`, "text/html");
    const root = document.querySelector("main");
    if (!root) return "";
    let count = 0;
    for (const image of root.querySelectorAll("img")) {
        const source = image.getAttribute("src") || "";
        const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
        const encoded = match?.[2] || "";
        const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
        if (!match || encoded.length % 4 !== 0 || (encoded.length / 4) * 3 - padding > 2 * 1024 * 1024 || ++count > 5) image.remove();
    }
    return root.innerHTML;
}
