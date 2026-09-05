use mailparse::{dateparse, parse_mail, DispositionType, MailHeaderMap, ParsedMail};

use crate::{
    db::CachedMessage,
    models::{AttachmentInfo, MessageDetail, MessageSummary},
};

pub fn cache_message(
    raw: &[u8],
    account_id: &str,
    folder: &str,
    uid: u32,
    flags: Vec<String>,
) -> Result<CachedMessage, String> {
    let parsed = parse_mail(raw).map_err(|e| e.to_string())?;
    let headers = parsed.get_headers();
    let subject = headers.get_first_value("Subject").unwrap_or_default();
    let sender = headers.get_first_value("From").unwrap_or_default();
    let recipients = headers.get_first_value("To").unwrap_or_default();
    let cc = headers.get_first_value("Cc").unwrap_or_default();
    let message_id = headers.get_first_value("Message-ID");
    let date = headers
        .get_first_value("Date")
        .and_then(|value| dateparse(&value).ok())
        .unwrap_or(0);
    let (text, _) = extract_bodies(&parsed);
    let preview = preview(&text, 240);

    Ok(CachedMessage {
        account_id: account_id.to_string(),
        folder: folder.to_string(),
        uid,
        message_id,
        subject,
        sender,
        recipients,
        cc,
        date,
        preview,
        flags,
        raw: raw.to_vec(),
    })
}

pub fn message_detail(summary: MessageSummary, cc: String, raw: &[u8]) -> Result<MessageDetail, String> {
    let parsed = parse_mail(raw).map_err(|e| e.to_string())?;
    let (body_text, body_html) = extract_bodies(&parsed);
    let attachments = attachment_infos(&parsed);

    Ok(MessageDetail { summary, cc, body_text, body_html, attachments })
}

pub fn attachment_bytes(raw: &[u8], index: usize) -> Result<(String, Vec<u8>), String> {
    let parsed = parse_mail(raw).map_err(|e| e.to_string())?;
    let mut current_index = 0usize;
    find_attachment(&parsed, index, &mut current_index)?
        .ok_or_else(|| "Attachment was not found".to_string())
}

fn extract_bodies(parsed: &ParsedMail<'_>) -> (String, Option<String>) {
    let mut text = None;
    let mut html = None;
    collect_bodies(parsed, &mut text, &mut html);

    if text.is_none() && parsed.subparts.is_empty() {
        text = parsed.get_body().ok();
    }

    let fallback = html.as_deref().map(strip_html).unwrap_or_default();
    (text.unwrap_or(fallback), html)
}

fn collect_bodies(parsed: &ParsedMail<'_>, text: &mut Option<String>, html: &mut Option<String>) {
    if !is_attachment(parsed) {
        match parsed.ctype.mimetype.as_str() {
            "text/plain" if text.is_none() => *text = parsed.get_body().ok(),
            "text/html" if html.is_none() => *html = parsed.get_body().ok(),
            _ => {}
        }
    }

    for part in &parsed.subparts {
        collect_bodies(part, text, html);
    }
}

fn attachment_infos(parsed: &ParsedMail<'_>) -> Vec<AttachmentInfo> {
    let mut attachments = Vec::new();
    collect_attachment_infos(parsed, &mut attachments);
    attachments
}

fn collect_attachment_infos(parsed: &ParsedMail<'_>, attachments: &mut Vec<AttachmentInfo>) {
    if is_attachment(parsed) {
        let index = attachments.len();
        attachments.push(AttachmentInfo {
            index,
            name: attachment_name(parsed, index),
            content_type: parsed.ctype.mimetype.clone(),
            size: parsed.get_body_raw().map(|bytes| bytes.len()).unwrap_or(0),
        });
    }

    for part in &parsed.subparts {
        collect_attachment_infos(part, attachments);
    }
}

fn find_attachment(
    parsed: &ParsedMail<'_>,
    target_index: usize,
    current_index: &mut usize,
) -> Result<Option<(String, Vec<u8>)>, String> {
    if is_attachment(parsed) {
        let index = *current_index;
        *current_index += 1;

        if index == target_index {
            let name = attachment_name(parsed, index);
            let bytes = parsed.get_body_raw().map_err(|e| e.to_string())?;
            return Ok(Some((name, bytes)));
        }
    }

    for part in &parsed.subparts {
        if let Some(found) = find_attachment(part, target_index, current_index)? {
            return Ok(Some(found));
        }
    }

    Ok(None)
}

fn is_attachment(part: &ParsedMail<'_>) -> bool {
    let disposition = part.get_content_disposition();
    disposition.disposition == DispositionType::Attachment
        || disposition.params.contains_key("filename")
        || part.ctype.params.contains_key("name")
        || (part.subparts.is_empty()
            && !part.ctype.mimetype.starts_with("text/")
            && !part.ctype.mimetype.starts_with("multipart/"))
}

fn attachment_name(part: &ParsedMail<'_>, index: usize) -> String {
    let disposition = part.get_content_disposition();
    disposition.params.get("filename")
        .or_else(|| part.ctype.params.get("name"))
        .cloned()
        .unwrap_or_else(|| format!("attachment-{}", index + 1))
}

fn preview(value: &str, max: usize) -> String {
    let collapsed = value.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(max).collect()
}

fn strip_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut inside = false;
    for ch in value.chars() {
        match ch {
            '<' => inside = true,
            '>' => { inside = false; out.push(' '); },
            _ if !inside => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}
