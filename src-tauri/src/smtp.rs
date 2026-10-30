use std::{path::Path, time::Duration};

use lettre::{
    message::{header::ContentType, Attachment, Mailbox, Message, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
};
use mailparse::{addrparse, MailAddr, SingleInfo};

use crate::models::{Account, SecurityMode, SendMessageInput};

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
    Ok(builder.credentials(credentials).timeout(Some(Duration::from_secs(30))).build())
}

async fn build_message(account: &Account, input: &SendMessageInput) -> Result<Message, String> {
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
    let to = parse_mailboxes(&input.to)?;
    if to.is_empty() {
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

    if input.attachments.is_empty() {
        return builder.singlepart(SinglePart::plain(input.body.clone())).map_err(|e| e.to_string());
    }

    let mut multipart = MultiPart::mixed().singlepart(SinglePart::plain(input.body.clone()));
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
