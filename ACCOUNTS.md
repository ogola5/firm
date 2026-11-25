# Accounts, enrolment and sign-in

Everyone signs in with their KPC email address. What a person sees after signing in (their dashboard, menu and data) follows from the role and section that the System Administrator approved for that address.

## The address rule

- Only addresses ending exactly `@kpc.co.ke` are accepted (setting `ALLOWED_EMAIL_DOMAINS`).
- Addresses are lower-cased.
- Look-alikes are refused, for example `kpc.co.ke.example.com`, `mail.kpc.co.ke` and `kpc.co`.
- Plus-addressing (`name+x@`) is refused, so one person has one address.
- The rule is in one place (`backend/app/services/accounts.py`) and is applied to enrolment, sign-in, password reset and administrator-created accounts. The browser shows the same message early (`frontend/src/lib/companyEmail.ts`), but the server decides.

## Account life cycle

```
start enrolment ──► UNVERIFIED ──(code + password)──► PENDING_APPROVAL ──approve──► ACTIVE ◄──► DISABLED
                                                                        └─reject──► REJECTED
```

| Step | Who | What happens |
| --- | --- | --- |
| 1. Details | The person | They enter their KPC email, full name, staff number, the job they do (requested role) and section, and optionally a job title. A 6-digit code is emailed. |
| 2. Confirm | The person | They enter the code and choose a password. This proves they own the mailbox, but not that the job is right. The administrators are emailed. |
| 3. Decide | System Administrator | Under **User management → Account requests**, they check the person against the staff list. They **approve** with the role and section, which may differ from the request, or **reject** with a reason. A staff number already used by another account is flagged. The person is emailed either way, and the decision is audited. |
| 4. Use | The person | They sign in and get the dashboard for their role and section. **My account** shows their details, who approved them and when, their last sign-in, what they can do (in plain words) and what they can see, and lets them change their password. |

The System Administrator role can never be requested. An administrator can also **create an account directly** for someone who cannot enrol. The same rules apply, and the person is emailed.

## Sign-in rules

| Situation | Answer |
| --- | --- |
| Not a KPC address | "Use your KPC email address (ending @kpc.co.ke)" |
| Unknown address or wrong password | The same "Wrong email or password." for both, so nobody can probe which addresses exist |
| 5 wrong passwords | Locked for 15 minutes, even with the right password. **Forgot password** still works. |
| Right password, account not usable yet | A plain explanation: finish confirming the email; waiting for approval; not approved, with the reason; or disabled |

## Passwords and codes

- **Passwords:** at least 10 characters, letters and numbers, and not containing the person's name or email. They are stored with bcrypt.
- **Codes:** 6 digits, valid for 15 minutes, with 5 tries. At most 5 codes per address per hour. A new code cancels the old one. Codes are stored only as a keyed hash.
- **Forgot password:** a code is sent to the KPC email, and the answer is the same whether or not the address has an account.
- **Changing or resetting a password** ends every other session. Each session token carries a password version.
- **Offline sign-in** works as before (see OFFLINE_SYNC_DESIGN.md), keyed by email.

## Email in this prototype

`kpc.co.ke` is a real domain, so **the prototype never sends email**. Every message it would send is stored and shown in the **demo mailbox** (`/mailbox`), which is linked from the enrolment and reset pages.

Before real use:

1. Set `DEMO_MAILBOX=false`. The mailbox then returns 404.
2. Connect KPC's mail relay in `services/accounts.send_mail`.

If KPC uses Microsoft 365, signing in with Entra ID (Azure AD) single sign-on can replace passwords and codes. The KPC address would then be proven by Microsoft, and approval of roles would stay as it is here.

## Seeded demonstration accounts

`demo.<name>@kpc.co.ke` with password `demo123` (see DEMO_GUIDE.md). They are created with the demonstration data, are never emailed, and are the only accounts offered in the sign-in page's demonstration list.
