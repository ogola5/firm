# Security

- JWT-backed demonstration sessions
- bcrypt password hashing
- Backend RBAC checks
- Section-scoped technical access, an HR-only people directory, and executive-summary-only CEO access
- HR contribution evidence excludes equipment identifiers and individual fault narratives; contribution metrics are not a production appraisal decision
- Procedure review and publication actions are role-checked, attributed and timestamped; authors cannot approve their own submissions
- Individual investigation and procedure history is restricted by fault/section scope; failed attempts remain recorded rather than hidden
- System Administrator-only account provisioning, role assignment and account activation control
- **Company-email identity** ([ACCOUNTS.md](ACCOUNTS.md)):
  - Only `@kpc.co.ke` addresses can enrol or sign in. The domain must match exactly (no sub-domains or look-alikes), addresses are lower-cased, and plus-addressing is refused. The same rule is applied by every path that creates an account.
  - Enrolment proves the person controls the mailbox with a 6-digit code. Codes are stored as an HMAC, last 15 minutes, allow 5 tries, and are limited to 5 per address per hour; a new code cancels the old one.
  - A person only *requests* a role. The System Administrator grants it (System Administrator itself cannot be requested). Approvals and rejections are audited.
  - Sign-in gives the same answer for an unknown address and a wrong password, and locks the account for 15 minutes after 5 failures. Account status is only revealed after a correct password.
  - Enrolment and password reset give the same answer whether or not the address has an account. The real owner of an existing address is emailed instead.
  - Passwords need at least 10 characters, letters and numbers, and must not contain the person's name or email. Changing or resetting a password ends every older session (the token carries a password version).
- Synthetic demo accounts only (`demo.<name>@kpc.co.ke`); enrolled people are never listed as demo accounts
- Append-only audit events
- Offline sign-in only for accounts already verified online on that device; the device keeps a PBKDF2-SHA-256 verifier (210,000 iterations, random salt), never the password; offline access lapses 7 days after the last online sign-in
- Offline changes are re-applied on the server as the authenticated user through the normal permission and workflow checks; events claiming another actor are rejected; an offline client cannot approve or publish anything
- Conflicting offline changes are held for an authorised decision, and re-applying runs with the original author's permissions
- Environment-based configuration (`DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`); the defaults are demo-only
- Unhandled server errors return a generic message; details stay in server logs
- Attachment uploads are type-checked and size-limited; stored files are addressed by server-generated keys
- The prototype is administrative and does not connect to control systems

Known gaps (prototype):
- **No real email.** The demo mailbox (`/mailbox`) shows every message, so anyone can read anyone's codes. It must be switched off with `DEMO_MAILBOX=false`, and a KPC mail relay (or Microsoft 365 / Entra ID single sign-on) connected, before real use.
- No IP-level rate limiting. Lockout is per account, which also lets someone lock another person out for 15 minutes by guessing.
- Apart from a password change, sessions are not revocable before expiry. Deactivation does take effect on the next request.
- The 429 lockout message reveals that an address has an account.
- The demo account list is public by design.
