# Administrative access

The public LLM dashboard has no human account login. Its manual `/api/admin/run-poller` HTTP endpoint is now unavailable outside explicit development mode, even with an admin token or spoofed forwarding headers. This closes the production token-only administrative path while preserving public reads and the separate IAM-authorized scheduled poller Lambda entry.

Do not re-enable a deployed human admin route without authenticator-based two-factor authentication. Development remains explicitly token-protected; forwarded headers alone are not trusted network isolation. Validation: `node scripts/check-admin-mode.mjs`; review the early production rejection before the token/source/poller code. Production release still follows the owning workflow and requires approval.
