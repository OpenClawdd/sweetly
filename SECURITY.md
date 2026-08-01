# Security Policy

## Reporting a Vulnerability

If you believe you have discovered a security vulnerability affecting this
project, please report it privately using GitHub's **Private Vulnerability
Reporting** feature on this repository, rather than opening a public issue.

Please include:
- A clear description of the issue
- Steps to reproduce (if applicable)
- Potential impact
- Any relevant logs or proof-of-concept details

We ask that security issues are not publicly disclosed before we have had an
opportunity to review and address the report.

## What's in scope

Sweetly is a local macOS desktop application. It talks to Apple Music via
AppleScript, to Apple's public web API using a user-supplied token, and to
several public lyrics services. Relevant concerns include:

- Handling of the user's `media-user-token` and Spotify refresh token (stored
  locally, never transmitted except to their intended services)
- The loopback OAuth redirect server (`127.0.0.1:8888`)
- IPC surface between the Electron main process and the renderer

This project is a fork of Spicy Lyrics (AGPL-3.0). Vulnerabilities in upstream
should be reported to the upstream project as well.
