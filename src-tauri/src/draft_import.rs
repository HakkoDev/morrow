//! Explicit, read-only import of drafts authored in another mail client.
//! Imports create *new* Morrow draft IDs; the original IMAP message is never
//! edited, tagged, deleted or paired with a Morrow-owned revision.
use crate::{
    db::Database,
    models::{Account, LocalDraft},
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use mailparse::{parse_mail, DispositionType, MailHeaderMap, ParsedMail};
use std::fs;

const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_FILES: usize = 40;
const MAX_INLINE_IMAGES: usize = 5;
const MAX_INLINE_BYTES: usize = 2 * 1024 * 1024;

pub(crate) struct ImportableDraft {
    draft: LocalDraft,
    files: Vec<(String, Vec<u8>)>,
}

fn safe_name(name: &str, index: usize) -> String {
    let segment = name.rsplit(['/', '\\']).next().unwrap_or("");
    let safe: String = segment
        .chars()
        .filter(|ch| !ch.is_control() && !matches!(ch, ':' | '/' | '\\'))
        .take(96)
        .collect();
    if safe.trim_matches('.').trim().is_empty() {
        format!("attachment-{}", index + 1)
    } else {
        safe
    }
}

fn collect_parts(
    part: &ParsedMail<'_>,
    plain: &mut Option<String>,
    html: &mut Option<String>,
    files: &mut Vec<(String, Vec<u8>, Option<String>, String)>,
) -> Result<(), String> {
    let typ = part.ctype.mimetype.to_ascii_lowercase();
    if matches!(
        typ.as_str(),
        "multipart/encrypted" | "multipart/signed" | "application/pkcs7-mime" | "application/pgp-encrypted" | "message/rfc822"
    ) {
        return Err("Encrypted, signed, or nested-message drafts cannot yet be imported without losing data. Original left untouched".into());
    }
    if !part.subparts.is_empty() {
        for child in &part.subparts {
            collect_parts(child, plain, html, files)?;
        }
        return Ok(());
    }
    if typ.starts_with("multipart/") {
        return Err("Malformed multipart draft; original left untouched".into());
    }
    let disp = part.get_content_disposition();
    let is_file = disp.disposition == DispositionType::Attachment
        || disp.params.contains_key("filename")
        || part.ctype.params.contains_key("name")
        || part.get_headers().get_first_value("Content-ID").is_some();
    if !is_file && typ == "text/plain" && plain.is_none() {
        *plain = Some(part.get_body().map_err(|e| e.to_string())?);
    } else if !is_file && typ == "text/html" && html.is_none() {
        *html = Some(part.get_body().map_err(|e| e.to_string())?);
    } else {
        if files.len() >= MAX_FILES {
            return Err("Draft contains more than 40 MIME attachments".into());
        }
        let bytes = part.get_body_raw().map_err(|e| e.to_string())?;
        if bytes.len() > MAX_BYTES {
            return Err("Attachment exceeds the import size limit".into());
        }
        let name = disp
            .params
            .get("filename")
            .or_else(|| part.ctype.params.get("name"))
            .cloned()
            .unwrap_or_else(|| format!("attachment-{}", files.len() + 1));
        let cid = part
            .get_headers()
            .get_first_value("Content-ID")
            .map(|v| v.trim().trim_start_matches('<').trim_end_matches('>').to_string());
        files.push((name, bytes, cid, typ));
    }
    Ok(())
}

/// Parse before writing any files. Unsupported forms fail closed, rather than
/// quietly converting a rich draft into a blank or attachment-less message.
pub(crate) fn parse_importable(account: &Account, raw: &[u8]) -> Result<ImportableDraft, String> {
    if raw.len() > MAX_BYTES {
        return Err("Draft exceeds 8 MB import limit".into());
    }
    let parsed = parse_mail(raw).map_err(|e| e.to_string())?;
    let headers = parsed.get_headers();
    if headers.get_first_value("X-Morrow-Draft-ID").is_some() {
        return Err("Morrow-owned drafts use the normal synchronization flow".into());
    }
    let mut plain = None;
    let mut html = None;
    let mut mime_files = Vec::new();
    collect_parts(&parsed, &mut plain, &mut html, &mut mime_files)?;
    let mut files = Vec::new();
    let mut image_count = 0usize;
    let mut content_ids = std::collections::HashSet::new();
    for (name, bytes, cid, mime) in mime_files {
        if cid.as_ref().is_some_and(|value| value.is_empty() || !content_ids.insert(value.clone())) {
            return Err("Draft contains empty or duplicate Content-ID values. Original left untouched".into());
        }
        let mut inlined = false;
        if let (Some(html), Some(cid)) = (html.as_mut(), cid.as_deref()) {
            let reference = format!("cid:{cid}");
            if html.contains(&reference) {
                if !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp")
                    || bytes.len() > MAX_INLINE_BYTES
                    || image_count >= MAX_INLINE_IMAGES
                    || infer::get(&bytes).is_none_or(|kind| kind.mime_type() != mime)
                {
                    return Err("Remote inline image cannot be represented safely by Morrow's editor. Original left untouched".into());
                }
                let url = format!("data:{mime};base64,{}", STANDARD.encode(&bytes));
                *html = html.replace(&reference, &url);
                image_count += 1;
                inlined = true;
            }
        }
        if !inlined {
            files.push((name, bytes));
        }
    }
    if html.as_deref().is_some_and(|markup| markup.to_ascii_lowercase().contains("cid:")) {
        return Err("Draft has unresolved CID references. Original left untouched".into());
    }
    // HTML-only imports retain a text fallback, rather than putting markup in
    // the plain-text alternative. Never evaluate or render remote HTML here.
    let body = plain.unwrap_or_else(|| {
        let mut text = String::new();
        let mut in_tag = false;
        for ch in html.as_deref().unwrap_or("").chars() {
            match ch {
                '<' => in_tag = true,
                '>' => {
                    in_tag = false;
                    text.push(' ');
                }
                _ if !in_tag => text.push(ch),
                _ => {}
            }
        }
        text.split_whitespace().collect::<Vec<_>>().join(" ")
    });
    Ok(ImportableDraft {
        draft: LocalDraft {
            id: uuid::Uuid::new_v4().to_string(),
            account_id: account.id.clone(),
            to: headers.get_first_value("To").unwrap_or_default(),
            cc: headers.get_first_value("Cc").unwrap_or_default(),
            bcc: headers.get_first_value("Bcc").unwrap_or_default(),
            subject: headers.get_first_value("Subject").unwrap_or_default(),
            body,
            html_body: html,
            in_reply_to: headers.get_first_value("In-Reply-To"),
            references: headers.get_first_value("References"),
            attachments: vec![],
            updated_at: 0,
        },
        files,
    })
}

/// Persist attachments into Morrow's application-data directory, not a temp
/// folder. The file names are generated locally, never taken as relative paths.
/// If disk writes or SQLite insertion fail, the original IMAP draft is intact.
pub fn import_copy(db: &Database, account: &Account, raw: &[u8]) -> Result<LocalDraft, String> {
    let mut import = parse_importable(account, raw)?;
    let id = import.draft.id.clone();
    let root = db.draft_assets_dir(&account.id, &id)?;
    if !import.files.is_empty() {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    }
    let mut paths = Vec::new();
    let result = (|| -> Result<(), String> {
        for (index, (name, bytes)) in import.files.iter().enumerate() {
            let path = root.join(format!("{:02}-{}", index + 1, safe_name(name, index)));
            fs::write(&path, bytes).map_err(|e| format!("Cannot preserve attachment: {e}"))?;
            paths.push(path.to_string_lossy().into_owned());
        }
        import.draft.attachments = paths;
        db.save_local_draft(&import.draft)?;
        db.mark_draft_sync_issue(
            &account.id,
            &id,
            "recovery",
            "Imported independent copy from another mail client. Original server message remains untouched",
        )?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&root);
        let _ = db.delete_local_draft(&account.id, &id);
    }
    result?;
    Ok(import.draft)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn account() -> Account {
        serde_json::from_value(serde_json::json!({
            "id": "account", "displayName": "Alice", "email": "a@example.org",
            "imapHost": "example.org", "imapPort": 993, "imapSecurity": "tls", "imapUsername": "a",
            "smtpHost": "example.org", "smtpPort": 465, "smtpSecurity": "tls", "smtpUsername": "a",
            "sentFolder": "Sent", "draftsFolder": "Drafts", "trashFolder": "Trash", "saveSentCopy": true
        }))
        .unwrap()
    }

    #[test]
    fn import_creates_independent_copy_with_bcc_and_attachment_bytes() {
        let raw = b"Subject: Foreign draft\r\nBcc: hidden@example.org\r\nContent-Type: multipart/mixed; boundary=parts\r\n\r\n--parts\r\nContent-Type: text/plain\r\n\r\nUnsent body\r\n--parts\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=../../file.bin\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--parts--\r\n";
        let imported = parse_importable(&account(), raw).unwrap();
        assert!(uuid::Uuid::parse_str(&imported.draft.id).is_ok());
        assert_eq!(imported.draft.account_id, "account");
        assert_eq!(imported.draft.bcc, "hidden@example.org");
        assert!(imported.draft.to.is_empty());
        assert!(imported.draft.body.contains("Unsent body"));
        assert_eq!(imported.files[0].1, b"hello");
    }

    #[test]
    fn import_rejects_owned_signed_and_falsely_typed_inline_images() {
        for raw in [
            "X-Morrow-Draft-ID: invalid\r\n\r\nBody",
            "Content-Type: multipart/signed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nBody\r\n--x--",
            "Content-Type: multipart/related; boundary=x\r\n\r\n--x\r\nContent-Type: text/html\r\n\r\n<img src='cid:image'>\r\n--x\r\nContent-Type: image/png\r\nContent-ID: <image>\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--x--",
        ] {
            assert!(parse_importable(&account(), raw.as_bytes()).is_err());
        }
    }
    #[test]
    fn path_names_ignore_parent_directories() {
        assert_eq!(safe_name("../../evil.txt", 0), "evil.txt");
        assert_eq!(safe_name("C:\\evil.txt", 0), "evil.txt");
        assert_eq!(safe_name("..", 3), "attachment-4");
    }
}
