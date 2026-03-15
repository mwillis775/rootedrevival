//! Email service for password reset and verification
//!
//! Supports SMTP for sending emails. Configure via environment variables:
//! - SMTP_HOST: SMTP server hostname
//! - SMTP_PORT: SMTP server port (default: 587)
//! - SMTP_USER: SMTP username
//! - SMTP_PASS: SMTP password
//! - SMTP_FROM: From email address
//! - EMAIL_ENABLED: Set to "true" to enable email sending

use std::sync::Arc;
use lettre::{
    message::{header::ContentType, Mailbox},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use parking_lot::RwLock;
use tracing::{info, warn, error};

/// Email configuration
#[derive(Clone, Debug)]
pub struct EmailConfig {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: String,
    pub smtp_pass: String,
    pub from_email: String,
    pub from_name: String,
    pub enabled: bool,
}

impl Default for EmailConfig {
    fn default() -> Self {
        Self {
            smtp_host: std::env::var("SMTP_HOST").unwrap_or_else(|_| "localhost".to_string()),
            smtp_port: std::env::var("SMTP_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(587),
            smtp_user: std::env::var("SMTP_USER").unwrap_or_default(),
            smtp_pass: std::env::var("SMTP_PASS").unwrap_or_default(),
            from_email: std::env::var("SMTP_FROM").unwrap_or_else(|_| "noreply@scholar.local".to_string()),
            from_name: std::env::var("SMTP_FROM_NAME").unwrap_or_else(|_| "Open Scholar".to_string()),
            enabled: std::env::var("EMAIL_ENABLED")
                .map(|v| v.to_lowercase() == "true")
                .unwrap_or(false),
        }
    }
}

/// Email service for sending transactional emails
pub struct EmailService {
    config: EmailConfig,
    mailer: Option<AsyncSmtpTransport<Tokio1Executor>>,
    /// Queue of pending emails when email is disabled (for testing/dev)
    pending_queue: Arc<RwLock<Vec<PendingEmail>>>,
}

#[derive(Clone, Debug)]
pub struct PendingEmail {
    pub to: String,
    pub subject: String,
    pub body: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl EmailService {
    /// Create a new email service
    pub fn new(config: EmailConfig) -> Self {
        let mailer = if config.enabled {
            let creds = Credentials::new(config.smtp_user.clone(), config.smtp_pass.clone());
            
            match AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host) {
                Ok(transport) => {
                    let mailer = transport
                        .port(config.smtp_port)
                        .credentials(creds)
                        .build();
                    info!("Email service initialized with SMTP: {}", config.smtp_host);
                    Some(mailer)
                }
                Err(e) => {
                    error!("Failed to create SMTP transport: {}", e);
                    None
                }
            }
        } else {
            warn!("Email service disabled - emails will be queued but not sent");
            None
        };

        Self {
            config,
            mailer,
            pending_queue: Arc::new(RwLock::new(Vec::new())),
        }
    }
    
    /// Create email service from environment variables
    pub fn from_env() -> Self {
        Self::new(EmailConfig::default())
    }

    /// Send an email
    pub async fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), EmailError> {
        let from: Mailbox = format!("{} <{}>", self.config.from_name, self.config.from_email)
            .parse()
            .map_err(|_| EmailError::InvalidAddress("from".to_string()))?;

        let to_mailbox: Mailbox = to
            .parse()
            .map_err(|_| EmailError::InvalidAddress(to.to_string()))?;

        let message = Message::builder()
            .from(from)
            .to(to_mailbox)
            .subject(subject)
            .header(ContentType::TEXT_HTML)
            .body(body.to_string())
            .map_err(|e| EmailError::BuildError(e.to_string()))?;

        match &self.mailer {
            Some(mailer) => {
                mailer.send(message).await.map_err(|e| EmailError::SendError(e.to_string()))?;
                info!("Email sent to {}: {}", to, subject);
                Ok(())
            }
            None => {
                // Queue the email for later or testing
                let pending = PendingEmail {
                    to: to.to_string(),
                    subject: subject.to_string(),
                    body: body.to_string(),
                    created_at: chrono::Utc::now(),
                };
                self.pending_queue.write().push(pending);
                warn!("Email queued (sending disabled): {} -> {}", subject, to);
                Ok(())
            }
        }
    }

    /// Send verification email
    pub async fn send_verification(&self, to: &str, username: &str, token: &str, base_url: &str) -> Result<(), EmailError> {
        let verify_url = format!("{}/verify?token={}", base_url, token);
        
        let subject = "Verify your Open Scholar account";
        let body = format!(r#"
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
        .header h1 {{ color: white; margin: 0; }}
        .content {{ background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }}
        .button {{ display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }}
        .footer {{ text-align: center; color: #666; font-size: 12px; margin-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎓 Open Scholar</h1>
        </div>
        <div class="content">
            <h2>Welcome, {username}!</h2>
            <p>Thank you for joining Open Scholar, the decentralized platform for academic publishing.</p>
            <p>Please verify your email address by clicking the button below:</p>
            <p style="text-align: center;">
                <a href="{verify_url}" class="button">Verify Email</a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; font-size: 12px; color: #666;">{verify_url}</p>
            <p>This link will expire in 24 hours.</p>
        </div>
        <div class="footer">
            <p>If you didn't create an account, you can safely ignore this email.</p>
            <p>© Open Scholar - Decentralized Knowledge Sharing</p>
        </div>
    </div>
</body>
</html>
"#, username = username, verify_url = verify_url);

        self.send(to, subject, &body).await
    }

    /// Send password reset email
    pub async fn send_password_reset(&self, to: &str, username: &str, token: &str, base_url: &str) -> Result<(), EmailError> {
        let reset_url = format!("{}/reset-password?token={}", base_url, token);
        
        let subject = "Reset your Open Scholar password";
        let body = format!(r#"
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
        .header h1 {{ color: white; margin: 0; }}
        .content {{ background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }}
        .button {{ display: inline-block; background: #e74c3c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }}
        .warning {{ background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 15px 0; }}
        .footer {{ text-align: center; color: #666; font-size: 12px; margin-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Password Reset</h1>
        </div>
        <div class="content">
            <h2>Hello, {username}</h2>
            <p>We received a request to reset your password for your Open Scholar account.</p>
            <p>Click the button below to set a new password:</p>
            <p style="text-align: center;">
                <a href="{reset_url}" class="button">Reset Password</a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; font-size: 12px; color: #666;">{reset_url}</p>
            <div class="warning">
                <strong>⚠️ Security Notice:</strong> This link will expire in 1 hour. If you didn't request a password reset, please ignore this email and your password will remain unchanged.
            </div>
        </div>
        <div class="footer">
            <p>If you didn't request this, someone may have entered your email by mistake.</p>
            <p>© Open Scholar - Decentralized Knowledge Sharing</p>
        </div>
    </div>
</body>
</html>
"#, username = username, reset_url = reset_url);

        self.send(to, subject, &body).await
    }

    /// Send welcome email after verification
    pub async fn send_welcome(&self, to: &str, username: &str) -> Result<(), EmailError> {
        let subject = "Welcome to Open Scholar!";
        let body = format!(r#"
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }}
        .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }}
        .header h1 {{ color: white; margin: 0; }}
        .content {{ background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }}
        .feature {{ display: flex; align-items: center; margin: 15px 0; }}
        .feature-icon {{ font-size: 24px; margin-right: 15px; }}
        .button {{ display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }}
        .footer {{ text-align: center; color: #666; font-size: 12px; margin-top: 20px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎉 Welcome!</h1>
        </div>
        <div class="content">
            <h2>Hello, {username}!</h2>
            <p>Your email has been verified and your account is now fully active.</p>
            <p>Here's what you can do with Open Scholar:</p>
            <div class="feature">
                <span class="feature-icon">📄</span>
                <div><strong>Upload Papers:</strong> Share your research with the world</div>
            </div>
            <div class="feature">
                <span class="feature-icon">🔬</span>
                <div><strong>Peer Review:</strong> Review and rate papers from other researchers</div>
            </div>
            <div class="feature">
                <span class="feature-icon">🌐</span>
                <div><strong>Decentralized:</strong> Your content is stored on GrabNet's P2P network</div>
            </div>
            <div class="feature">
                <span class="feature-icon">🔒</span>
                <div><strong>Secure:</strong> Your identity is protected with ed25519 cryptography</div>
            </div>
            <p style="text-align: center;">
                <a href="https://scholar.rootedrevival.us" class="button">Start Exploring</a>
            </p>
        </div>
        <div class="footer">
            <p>© Open Scholar - Decentralized Knowledge Sharing</p>
        </div>
    </div>
</body>
</html>
"#, username = username);

        self.send(to, subject, &body).await
    }

    /// Get pending emails (for testing/debugging)
    pub fn get_pending_emails(&self) -> Vec<PendingEmail> {
        self.pending_queue.read().clone()
    }

    /// Clear pending emails
    pub fn clear_pending_emails(&self) {
        self.pending_queue.write().clear();
    }

    /// Check if email service is enabled
    pub fn is_enabled(&self) -> bool {
        self.config.enabled && self.mailer.is_some()
    }
}

/// Email errors
#[derive(Debug, thiserror::Error)]
pub enum EmailError {
    #[error("Invalid email address: {0}")]
    InvalidAddress(String),
    
    #[error("Failed to build email: {0}")]
    BuildError(String),
    
    #[error("Failed to send email: {0}")]
    SendError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = EmailConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.smtp_port, 587);
    }

    #[tokio::test]
    async fn test_disabled_email_queues() {
        let config = EmailConfig {
            enabled: false,
            ..Default::default()
        };
        
        let service = EmailService::new(config);
        
        let result = service.send("test@example.com", "Test Subject", "Test Body").await;
        assert!(result.is_ok());
        
        let pending = service.get_pending_emails();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].to, "test@example.com");
    }
}
