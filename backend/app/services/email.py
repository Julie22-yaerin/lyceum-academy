"""
Email sending — plain SMTP via stdlib smtplib, deliberately, so any
provider that hands out SMTP credentials works (Gmail app password,
SendGrid/Resend/SES's SMTP relay, a real mail server) without pulling in a
vendor SDK. There was no working email-send capability anywhere in this
backend before this file — Firebase Auth was sending its own verification/
reset emails from Firebase's own infrastructure, which is a separate path
this module doesn't touch.

Without SMTP_HOST/SMTP_USER/SMTP_PASSWORD configured, send_email() logs the
message instead of sending it — loud enough to notice in dev, but this is
NOT a substitute for real delivery. Production needs real SMTP credentials
in .env before OTP codes actually reach anyone's inbox.
"""

from __future__ import annotations

import logging
import smtplib
from email.mime.text import MIMEText

from app.core.config import settings

log = logging.getLogger("pclick.email")


def configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_user and settings.smtp_password)


def send_email(to: str, subject: str, body: str) -> bool:
    """Returns True if the message was handed to an SMTP server successfully.
    Never raises — a failed email must not crash the caller's request; the
    caller decides how to react to a False return."""
    if not configured():
        log.warning(
            "SMTP not configured — email NOT sent. to=%s subject=%r body=%r",
            to, subject, body,
        )
        return False

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.smtp_from, [to], msg.as_string())
        return True
    except Exception:
        log.error("send_email failed for %s", to, exc_info=True)
        return False
