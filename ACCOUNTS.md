# Accounts, enrolment and sign-in

Everyone signs in with their KPC email address. What a person sees after signing in (their dashboard, menu and data) follows from the role and section that the System Administrator approved for that address.

## The address rule

- Only addresses ending exactly `@kpc.co.ke` are accepted. For the demonstration this domain is fixed in the code and settings (`ALLOWED_EMAIL_DOMAINS`). KPC IT will confirm the real rules, such as other domains or single sign-on, before go-live.
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

## What each level sees (decided by the account)

The approved role and section on the account decide what a person sees. The server builds one **access profile** per level (`backend/app/services/workspace.py`): the home page, the menu, the scope and the list of things they can do. It returns this with the account at sign-in and from `/auth/me`. The browser draws the profile and keeps no role lists of its own. Every API still checks the role itself, so editing what the browser holds unlocks nothing.

| Level | Home page | What it is for | Scope |
| --- | --- | --- | --- |
| OPS, Operations | My reports | Faults you reported and where each one is; report a new one | All equipment (reporting); own reports |
| SA, Systems Automation | My jobs | New faults to sort first, then own jobs | Systems Automation |
| ST, Senior Technician | My jobs | Jobs given to you: print the card, go, write it up | Own section |
| PT, Principal Technician | My jobs | As ST | Own section |
| DEV, Developer / Owner | Administration + developer tools | Everything the System Administrator has, plus view as someone (read-only), banner, feature switches, demo reset. A System Administrator with the `developer` flag (seed or command line only) | Whole system |
| CT, Chief Technician | Section oversight | See who took what; check write-ups after the fix; approve hand-overs; give a job to someone when nobody has taken it; procedure review; section analytics | Own section |
| AE / E, Assistant Engineer / Engineer | My jobs | Section jobs that need an engineer | Own section |
| SE, Senior Engineer | My jobs | As E, and can confirm equipment back in service | Own section |
| CE, Chief Engineer | Section engineering | The section's figures for the last 4 weeks, the equipment needing attention, then own jobs; procedure review; section analytics | Own section |
| MM, Maintenance Manager | Maintenance overview | All sections: workload, response, restoration, recurring problems; analytics | All sections |
| GM, GM Operations & Maintenance | Operations & Maintenance | How faults move between Operations and sections, and where they wait | All sections |
| SUP, Supervisor | Supervision | Procedures waiting for publication and the overall picture | All sections |
| HR, HR Officer | Workforce overview | Staff, roles, contribution evidence; no fault details | Staff records |
| MD, Managing Director / CEO | Executive summary | Headline figures and trends only | Company headline figures |
| ADMIN, System Administrator | Administration | Account requests, accounts, levels and sections | All sections |

The level code is shown beside the person's name in the menu. **My account** lists what they can do in plain words.

## The session carries the account

Each sign-in returns a signed token with these claims:
- `sub`: the person
- `email`
- `role`, `level` and `section`
- `av`: the access version, a fingerprint of the role, section and status
- `pv`: the password version
- an expiry

On every request the server checks the signature, then compares `av` and `pv` with the account as it is *now*:
- **The administrator changed the person's level or section** (User management → **Change access**, for example a promotion from ST to PT), or disabled the account: the next request is refused with "Your access was changed by the System Administrator. Sign in again." The person lands on the sign-in page with that message, and their next sign-in shows the view for their new level.
- **The password changed:** every other session ends.
- **A token edited or forged** (for example, changing `role` to administrator) fails the signature check and is refused.

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
