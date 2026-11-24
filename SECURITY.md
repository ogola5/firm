# Security

- JWT-backed demonstration sessions
- bcrypt password hashing
- Backend RBAC checks
- Section-scoped technical access, an HR-only people directory, and executive-summary-only CEO access
- HR contribution evidence excludes equipment identifiers and individual fault narratives; contribution metrics are not a production appraisal decision
- Procedure review and publication actions are role-checked, attributed and timestamped; authors cannot approve their own submissions
- Individual investigation and procedure history is restricted by fault/section scope; failed attempts remain recorded rather than hidden
- System Administrator-only account provisioning, role assignment and account activation control
- Synthetic demo accounts only
- Append-only audit events
- Offline sign-in only for accounts already verified online on that device; the device keeps a PBKDF2-SHA-256 verifier (210,000 iterations, random salt), never the password; offline access lapses 7 days after the last online sign-in
- Offline changes are re-applied on the server as the authenticated user through the normal permission and workflow checks; events claiming another actor are rejected; an offline client cannot approve or publish anything
- Conflicting offline changes are held for an authorised decision, and re-applying runs with the original author's permissions
- Environment-based configuration (`DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`); the defaults are demo-only
- Unhandled server errors return a generic message; details stay in server logs
- Attachment uploads are type-checked and size-limited; stored files are addressed by server-generated keys
- The prototype is administrative and does not connect to control systems

Known gaps (prototype): no rate limiting yet; JWTs are not revocable before expiry; the demo account list is public by design.
