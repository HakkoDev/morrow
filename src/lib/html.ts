import DOMPurify from "dompurify";

export function sanitizedEmailDocument(html: string, allowRemoteImages: boolean, dark = false) {
    const clean = DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["script", "object", "embed", "form", "input", "button", "textarea"],
        FORBID_ATTR: ["onerror", "onload", "onclick", "srcset"],
    });
    const imgPolicy = allowRemoteImages ? "https: http: data:" : "data:";
    const darkCss = dark
        ? `html,body{background:#181b20!important;color:#e6e7ea!important;color-scheme:dark!important}body :where(p,div,span,td,th,h1,h2,h3,h4,h5,h6,blockquote,li){color:inherit!important;background-color:transparent!important}body a{color:#9ec5ff!important}body table{background:transparent!important}body img{background:transparent!important}`
        : "";
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imgPolicy}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;margin:24px;color:#171717;line-height:1.55;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#315bea}pre{white-space:pre-wrap}${darkCss}</style></head><body>${clean}</body></html>`;
}
