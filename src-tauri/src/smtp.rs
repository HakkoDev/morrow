use std::{
    hash::{Hash, Hasher},
    path::Path,
    time::Duration,
};

use lettre::{
    address::Envelope,
    message::{header::ContentType, Attachment, Mailbox, Message, MultiPart, SinglePart},
    transport::smtp::authentication::{Credentials, Mechanism},
    AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
};
use mailparse::{addrparse, MailAddr, SingleInfo};

use crate::models::{Account, LocalDraft, SecurityMode, SendMessageInput};

pub async fn test(account: &Account, password: &str) -> Result<(), String> {
    let transport = transport(account, password)?;
    let connected = transport.test_connection().await.map_err(|e| format!("SMTP connection failed: {e}"))?;
    if !connected {
        return Err("SMTP server did not confirm the connection".into());
    }
    Ok(())
}

pub async fn send(account: &Account, password: &str, input: &SendMessageInput) -> Result<Vec<u8>, String> {
    let message = build_message(account, input).await?;
    let formatted = message.formatted();
    let transport = transport(account, password)?;
    transport.send(message).await.map_err(|e| format!("SMTP send failed: {e}"))?;
    Ok(formatted)
}

/// Build an RFC 5322 copy for a Morrow-owned IMAP Drafts folder. The custom
/// headers are derived only from a validated UUID and local content fingerprint,
/// never from free-form recipient or subject input.
pub async fn build_draft_message(account: &Account, draft: &LocalDraft) -> Result<(Vec<u8>, String), String> {
    let id = uuid::Uuid::parse_str(&draft.id).map_err(|_| "Only UUID-based Morrow drafts can be synchronized".to_string())?;
    let input = SendMessageInput {
        account_id: draft.account_id.clone(),
        to: draft.to.clone(),
        cc: draft.cc.clone(),
        bcc: draft.bcc.clone(),
        subject: draft.subject.clone(),
        body: draft.body.clone(),
        html_body: draft.html_body.clone(),
        in_reply_to: draft.in_reply_to.clone(),
        references: draft.references.clone(),
        attachments: draft.attachments.clone(),
    };
    let before = draft_revision(draft);
    let message = build_message_internal(account, &input, false).await?;
    let fingerprint = draft_revision(draft);
    if before != fingerprint {
        return Err("An attachment changed while building the draft; retry after the file is saved".into());
    }
    let header = format!("X-Morrow-Draft-ID: {id}\r\nX-Morrow-Draft-Revision: {fingerprint}\r\n");
    let mut bytes = header.into_bytes();
    bytes.extend_from_slice(&message.formatted());
    Ok((bytes, fingerprint))
}

pub(crate) fn draft_revision(draft: &LocalDraft) -> String {
    // Do not use timestamps: two edits in the same second still get distinct
    // revisions. This hash is an idempotency hint, not a security primitive.
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (
        &draft.to,
        &draft.cc,
        &draft.bcc,
        &draft.subject,
        &draft.body,
        &draft.html_body,
        &draft.in_reply_to,
        &draft.references,
        &draft.attachments,
    )
        .hash(&mut hasher);
    // File contents can change without changing the saved attachment paths.
    use std::io::Read;
    for path in &draft.attachments {
        match std::fs::File::open(path) {
            Ok(mut file) => {
                let mut buffer = [0u8; 65536];
                loop {
                    match file.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(size) => buffer[..size].hash(&mut hasher),
                        Err(error) => {
                            format!("unreadable:{:?}", error.kind()).hash(&mut hasher);
                            break;
                        }
                    }
                }
            }
            Err(error) => format!("unreadable:{:?}", error.kind()).hash(&mut hasher),
        }
    }
    format!("{:016x}", hasher.finish())
}

fn transport(account: &Account, password: &str) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let credentials = Credentials::new(account.smtp_username.clone(), password.to_string());
    let builder = match account.smtp_security {
        SecurityMode::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(&account.smtp_host)
            .map_err(|e| e.to_string())?
            .port(account.smtp_port),
        SecurityMode::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&account.smtp_host)
            .map_err(|e| e.to_string())?
            .port(account.smtp_port),
        SecurityMode::Plain => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&account.smtp_host).port(account.smtp_port),
    };
    let builder = builder.credentials(credentials).timeout(Some(Duration::from_secs(30)));
    let builder = if account.auth_method == "password" {
        builder
    } else {
        builder.authentication(vec![Mechanism::Xoauth2])
    };
    Ok(builder.build())
}

async fn build_message(account: &Account, input: &SendMessageInput) -> Result<Message, String> {
    build_message_internal(account, input, true).await
}

// RFC 5322 allows a saved draft without a To field. SMTP sends never do.
async fn build_message_internal(account: &Account, input: &SendMessageInput, require_recipient: bool) -> Result<Message, String> {
    let from = Mailbox::new(
        if account.display_name.trim().is_empty() {
            None
        } else {
            Some(account.display_name.clone())
        },
        account.email.parse().map_err(|e| format!("Invalid From address: {e}"))?,
    );

    let mut builder = Message::builder()
        .from(from)
        .subject(input.subject.clone())
        .message_id(None)
        .user_agent(format!("Morrow/{}", env!("CARGO_PKG_VERSION")));
    if !require_recipient {
        // Bcc addresses belong in a stored draft, but are normally removed
        // from a message that is actually transmitted by SMTP.
        builder = builder.keep_bcc();
        if input.to.trim().is_empty() && input.cc.trim().is_empty() && input.bcc.trim().is_empty() {
            // Lettre requires an SMTP envelope even for a message that is
            // ONLY formatted and appended to IMAP. This self-addressed
            // envelope is never submitted to SMTP or added to the MIME To.
            let address: lettre::Address = account.email.parse().map_err(|e| format!("Invalid draft account address: {e}"))?;
            let envelope = Envelope::new(Some(address.clone()), vec![address]).map_err(|e| e.to_string())?;
            builder = builder.envelope(envelope);
        }
    }
    if let Some(parent) = input.in_reply_to.as_ref().filter(|v| valid_message_ids(v)) {
        builder = builder.in_reply_to(parent.clone());
    }
    if let Some(refs) = input.references.as_ref().filter(|v| valid_message_ids(v)) {
        builder = builder.references(refs.clone());
    }
    let to = parse_mailboxes(&input.to)?;
    if to.is_empty() && require_recipient {
        return Err("At least one recipient is required".into());
    }
    for mailbox in to {
        builder = builder.to(mailbox);
    }
    for mailbox in parse_mailboxes(&input.cc)? {
        builder = builder.cc(mailbox);
    }
    for mailbox in parse_mailboxes(&input.bcc)? {
        builder = builder.bcc(mailbox);
    }

    let (html, inline_images) = match input.html_body.as_deref().filter(|html| !html.trim().is_empty()) {
        Some(html) => {
            let (processed, images) = extract_inline_images(html)?;
            (Some(processed), images)
        }
        None => (None, Vec::new()),
    };
    // Keep multipart/alternative for clients with no HTML support. CID images
    // live in multipart/related, never as external tracking URLs.
    let message_body = if let Some(html) = html {
        let alternative = MultiPart::alternative().singlepart(SinglePart::plain(input.body.clone()));
        if inline_images.is_empty() {
            alternative.singlepart(SinglePart::builder().header(ContentType::TEXT_HTML).body(html))
        } else {
            let mut related = MultiPart::related().singlepart(SinglePart::builder().header(ContentType::TEXT_HTML).body(html));
            for (cid, mime, bytes) in inline_images {
                related = related.singlepart(Attachment::new_inline(cid).body(bytes, ContentType::parse(&mime).map_err(|e| e.to_string())?));
            }
            alternative.multipart(related)
        }
    } else {
        MultiPart::alternative().singlepart(SinglePart::plain(input.body.clone()))
    };

    if input.attachments.is_empty() {
        return builder.multipart(message_body).map_err(|e| e.to_string());
    }

    let mut multipart = MultiPart::mixed().multipart(message_body);
    for attachment_path in &input.attachments {
        let path = Path::new(attachment_path);
        let data = tokio::fs::read(path)
            .await
            .map_err(|e| format!("Could not read attachment {}: {e}", path.display()))?;
        let filename = path.file_name().and_then(|name| name.to_str()).unwrap_or("attachment").to_string();
        let mime = mime_guess::from_path(path).first_or_octet_stream().essence_str().to_string();
        let content_type = ContentType::parse(&mime).map_err(|e| e.to_string())?;
        multipart = multipart.singlepart(Attachment::new(filename).body(data, content_type));
    }
    builder.multipart(multipart).map_err(|e| e.to_string())
}

/// Convert explicitly inserted data-URL images to MIME CID attachments. A
/// server-side size/count check means compromised renderer HTML cannot force
/// unbounded processing or inject arbitrary attachment types.
type InlineImage = (String, String, Vec<u8>);

fn extract_inline_images(html: &str) -> Result<(String, Vec<InlineImage>), String> {
    use std::{
        borrow::Cow,
        collections::{HashMap, HashSet},
        sync::{Arc, Mutex},
    };
    if html.len() > 17_000_000 {
        return Err("Rich-text body is too large".into());
    }
    // Parse HTML rather than searching substrings: quoting, casing, entities and
    // text mentioning src= must not bypass limits or create broken MIME parts.
    let images = Arc::new(Mutex::new(Vec::<InlineImage>::new()));
    let error = Arc::new(Mutex::new(None::<String>));
    let found = Arc::clone(&images);
    let failure = Arc::clone(&error);
    let output = ammonia::Builder::default()
        .tags(
            ["div", "p", "br", "b", "strong", "em", "i", "u", "ul", "ol", "li", "span", "blockquote", "img"]
                .into_iter()
                .collect(),
        )
        .generic_attributes(HashSet::new())
        .tag_attributes(HashMap::from([("img", HashSet::from(["src", "alt"]))]))
        .url_schemes(HashSet::from(["data", "cid"]))
        .attribute_filter(move |tag, attribute, value| {
            if tag != "img" {
                return None;
            }
            if attribute == "alt" {
                return Some(Cow::Owned(value.chars().take(256).collect()));
            }
            if attribute != "src" {
                return None;
            }
            let mut images = found.lock().expect("image extraction lock");
            let parsed = (|| -> Result<_, String> {
                if images.len() >= 5 {
                    return Err("No more than five inline images are supported".into());
                }
                let (media, encoded) = value.split_once(";base64,").ok_or("Inline images must use base64 data URLs")?;
                let media = media.strip_prefix("data:").ok_or("Inline images must use data URLs")?;
                if !matches!(media, "image/png" | "image/jpeg" | "image/gif" | "image/webp") {
                    return Err("Unsupported inline image format".into());
                }
                if encoded.len() > 2_796_204 {
                    return Err("Inline image exceeds the 2 MB limit".into());
                }
                let bytes = decode_image_base64(encoded)?;
                if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 {
                    return Err("Inline image exceeds the 2 MB limit or is empty".into());
                }
                if infer::get(&bytes).is_none_or(|kind| kind.mime_type() != media) {
                    return Err("Inline image content does not match its declared format".into());
                }
                Ok((media.to_owned(), bytes))
            })();
            match parsed {
                Ok((mime, bytes)) => {
                    let cid = format!("morrow-inline-{}@morrow.invalid", images.len() + 1);
                    let source = format!("cid:{cid}");
                    images.push((cid, mime, bytes));
                    Some(Cow::Owned(source))
                }
                Err(message) => {
                    *failure.lock().expect("image error lock") = Some(message);
                    None
                }
            }
        })
        .clean(html)
        .to_string();
    if let Some(error) = error.lock().expect("image error lock").take() {
        return Err(error);
    }
    let images = std::mem::take(&mut *images.lock().expect("image extraction lock"));
    Ok((output, images))
}

fn decode_image_base64(encoded: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("Invalid inline image base64: {error}"))
}

fn parse_mailboxes(value: &str) -> Result<Vec<Mailbox>, String> {
    if value.trim().is_empty() {
        return Ok(Vec::new());
    }
    let parsed = addrparse(value).map_err(|e| format!("Invalid recipient list: {e}"))?;
    let mut out = Vec::new();
    for address in parsed.iter() {
        match address {
            MailAddr::Single(info) => out.push(convert_mailbox(info)?),
            MailAddr::Group(group) => {
                for info in &group.addrs {
                    out.push(convert_mailbox(info)?);
                }
            }
        }
    }
    Ok(out)
}

fn convert_mailbox(info: &SingleInfo) -> Result<Mailbox, String> {
    Ok(Mailbox::new(
        info.display_name.clone(),
        info.addr.parse().map_err(|e| format!("Invalid email address {}: {e}", info.addr))?,
    ))
}

fn valid_message_ids(value: &str) -> bool {
    let tokens = value.split_whitespace().collect::<Vec<_>>();
    !tokens.is_empty()
        && tokens.len() <= 50
        && value.len() <= 4000
        && tokens.iter().all(|token| {
            token.starts_with('<') && token.ends_with('>') && token.contains('@') && !token.chars().any(|ch| ch == '\r' || ch == '\n' || ch == '\0')
        })
}

#[cfg(test)]
mod reply_tests {
    use super::*;
    #[test]
    fn reply_headers_cannot_inject_newlines() {
        assert!(valid_message_ids("<root@example.org> <reply@example.org>"));
        assert!(!valid_message_ids("<root@example.org>\r\nBcc:evil@example.org"));
    }

    #[tokio::test]
    async fn rich_mail_contains_decodable_plain_and_html_alternatives_with_attachments() {
        let account = Account {
            auth_method: "password".into(),
            oauth_client_id: String::new(),
            id: "a".into(),
            display_name: "Alice".into(),
            email: "a@example.org".into(),
            imap_host: "example.org".into(),
            imap_port: 993,
            imap_security: SecurityMode::Tls,
            imap_username: "a".into(),
            smtp_host: "example.org".into(),
            smtp_port: 465,
            smtp_security: SecurityMode::Tls,
            smtp_username: "a".into(),
            sent_folder: "Sent".into(),
            drafts_folder: "Drafts".into(),
            trash_folder: "Trash".into(),
            save_sent_copy: true,
        };
        let mut input: SendMessageInput = serde_json::from_value(serde_json::json!({
            "accountId": "a", "to": "to@example.org", "subject": "Rich message", "body": "Bold text",
            "htmlBody": "<p><b>Bold text</b></p>", "inReplyTo": "<parent@example.org>", "references": "<parent@example.org>"
        }))
        .unwrap();
        let raw = build_message(&account, &input).await.unwrap().formatted();
        let parsed = mailparse::parse_mail(&raw).unwrap();
        assert_eq!(parsed.ctype.mimetype, "multipart/alternative");
        assert_eq!(parsed.subparts.len(), 2);
        assert_eq!(parsed.subparts[0].ctype.mimetype, "text/plain");
        assert_eq!(parsed.subparts[1].ctype.mimetype, "text/html");
        assert!(parsed.subparts[0].get_body().unwrap().contains("Bold text"));
        assert!(parsed.subparts[1].get_body().unwrap().contains("<b>Bold text</b>"));
        let path = std::env::temp_dir().join(format!("morrow-mime-{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&path, b"attachment contents").unwrap();
        input.attachments.push(path.to_string_lossy().into_owned());
        let built = build_message(&account, &input).await;
        std::fs::remove_file(&path).unwrap();
        let raw = built.unwrap().formatted();
        let mixed = mailparse::parse_mail(&raw).unwrap();
        assert_eq!(mixed.ctype.mimetype, "multipart/mixed");
        assert_eq!(mixed.subparts[0].ctype.mimetype, "multipart/alternative");
        assert_eq!(mixed.subparts[0].subparts.len(), 2);
        assert_eq!(mixed.subparts[1].get_body_raw().unwrap(), b"attachment contents");
    }
}

#[cfg(test)]
mod inline_image_tests {
    use super::{decode_image_base64, extract_inline_images};
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";

    #[test]
    fn cid_image_mime_is_generated_and_base64_is_validated() {
        for source in [
            format!("<p><img src=\"data:image/png;base64,{PNG}\"></p>"),
            format!("<IMG SRC='data:image/png;base64,{PNG}'>"),
        ] {
            let (html, images) = extract_inline_images(&source).unwrap();
            assert!(html.contains("src=\"cid:morrow-inline-1@morrow.invalid\""));
            assert_eq!(images[0].2, decode_image_base64(PNG).unwrap());
        }
        assert!(decode_image_base64("aGVsbG8===").is_err());
        assert!(decode_image_base64("____").is_err());
    }

    #[test]
    fn inline_images_enforce_content_count_size_and_sanitization() {
        let image = format!("<img src=\"data:image/png;base64,{PNG}\">");
        assert_eq!(extract_inline_images(&image.repeat(5)).unwrap().1.len(), 5);
        assert!(extract_inline_images(&image.repeat(6)).is_err());
        for source in [
            "<img src='data:image/png;base64,aGVsbG8='>".into(),
            format!("<img src='data:image/jpeg;base64,{PNG}'>"),
            format!("<img src='data:image/svg+xml;base64,{PNG}'>"),
            format!("<img src='data:image/png;base64,{}'>", "A".repeat(2_796_205)),
        ] {
            assert!(extract_inline_images(&source).is_err());
        }
        let (html, images) = extract_inline_images("<script>alert(1)</script><p onclick='alert(1)'>src=not-an-image</p>").unwrap();
        assert!(images.is_empty());
        assert!(!html.contains("script") && !html.contains("onclick"));
    }
}
