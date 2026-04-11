# Codey

Codey is a TypeScript CLI and helper library for validating OpenAI web flows and reading Exchange mailbox data through Microsoft Graph.

## Features

- Validate OpenAI and ChatGPT page flows with Patchright Chrome sessions
- Read Exchange mailbox folders and messages through Microsoft Graph application permissions
- Support a configurable catch-all email prefix convention such as `codey*`
- Configure settings with environment variables or a JSON config file
- Persist ChatGPT registration identities locally for later login attempts, including password and virtual passkey data

## Requirements

- Node.js 20+
- pnpm 10+
- Exchange Online / Microsoft 365
- A Microsoft Entra ID app registration if you want to use the Exchange commands
- Patchright Chrome installed with `pnpx patchright install chrome`

## Installation

```bash
pnpm install
pnpx patchright install chrome
```

## Configuration

Codey loads environment variables from a local `.env` file automatically. You can also pass a JSON config file with `--config`.

### 1. Create your environment file

Copy `C:\Users\Summp\Desktop\codey\.env.example` to `.env` and update the values you need.

Example:

```env
HEADLESS=false
SLOW_MO=0
OPENAI_BASE_URL=https://openai.com
CHATGPT_URL=https://chatgpt.com
DEFAULT_TIMEOUT_MS=15000
NAVIGATION_TIMEOUT_MS=30000

EXCHANGE_TENANT_ID=your-tenant-id
EXCHANGE_CLIENT_ID=your-app-client-id
EXCHANGE_CLIENT_SECRET=your-app-client-secret
EXCHANGE_MAILBOX=codey-shared@contoso.com
EXCHANGE_CATCH_ALL_PREFIX=codey
CODEY_CREDENTIALS_MASTER_KEY=replace-this-with-a-long-random-secret
```

`CODEY_CREDENTIALS_MASTER_KEY` is optional but strongly recommended. When it is set, Codey encrypts persisted ChatGPT identities with AES-256-GCM before writing them to disk.

`VIRTUAL_AUTHENTICATOR_AAGUID` is optional. When omitted, Codey uses Bitwarden's AAGUID (`d548826e-79b4-db40-a3d8-11116f7e8349`) for the virtual authenticator so attestation requests receive a stable default authenticator identity.

### 2. Configure Exchange access

To use the `exchange` commands, create a Microsoft Entra ID application with Microsoft Graph application permissions.

#### Required values

- `EXCHANGE_TENANT_ID`: Your Microsoft Entra tenant ID
- `EXCHANGE_CLIENT_ID`: The application (client) ID of your app registration
- `EXCHANGE_CLIENT_SECRET`: A client secret created for that app
- `EXCHANGE_MAILBOX`: The mailbox address to query, for example `codey-shared@contoso.com`

#### Recommended setup steps

1. Open the Azure portal and go to **Microsoft Entra ID** -> **App registrations**.
2. Create or select an app registration.
3. Under **Certificates & secrets**, create a new client secret and save it securely.
4. Under **API permissions**, add **Microsoft Graph** -> **Application permissions**.
5. Grant the mail permissions required by your use case, such as:
   - `Mail.Read`
   - `Mail.ReadBasic.All` (optional if basic metadata is enough)
6. Click **Grant admin consent** for the tenant.
7. Put the tenant ID, client ID, client secret, and mailbox address in your `.env` file or JSON config.

> Note: This project uses the OAuth 2.0 client credentials flow.

### 3. Optional but recommended: configure a shared mailbox for Codey

If you do not want to use a dedicated user mailbox for automation, configure an Exchange shared mailbox specifically for Codey.

#### Why use a shared mailbox

- Keeps Codey traffic isolated from personal inboxes
- Avoids creating a separate end-user login just for test mail
- Gives admins a single mailbox to inspect for automation issues

#### How to configure the shared mailbox in Microsoft 365 admin

1. Open the **Microsoft 365 admin center**.
2. Go to **Teams & groups** -> **Shared mailboxes**.
3. Click **Add a shared mailbox**.
4. Enter a name such as `Codey Shared Mailbox`.
5. Enter an email such as `codey-shared@contoso.com`.
6. Create the mailbox.
7. Wait until the mailbox appears in Exchange Online.

#### Exchange-side recommendations

After the shared mailbox exists, ask your Microsoft 365 / Exchange admin to:

1. Confirm the shared mailbox can receive mail from the scenarios you want to test.
2. Create any mail-flow or routing rules needed for prefixed addresses such as `codey*@contoso.com`.
3. If required by your tenant policy, scope your app registration so it can read this shared mailbox.
4. Verify the mailbox has an Inbox and that test messages arrive there.

#### What to put in Codey config

Use the shared mailbox SMTP address as `EXCHANGE_MAILBOX`.

Example:

```env
EXCHANGE_MAILBOX=codey-shared@contoso.com
```

This is optional. A normal mailbox also works if that better matches your environment.

### 4. Catch-all prefix convention

If your mailbox setup uses prefixed test addresses such as `codey*`, configure the prefix in Codey so your application and test flows can use a consistent address pattern.

#### Supported configuration

- `EXCHANGE_CATCH_ALL_PREFIX`: The reserved address prefix, for example `codey`

#### Example convention

- Shared mailbox: `codey-shared@contoso.com`
- Prefix: `codey`
- Test address pattern: `codey*@contoso.com`

#### Important rule-setting note

If you create a dedicated Exchange mail-flow rule for Codey addresses, make sure the rule is configured to **stop processing more rules** after it matches.

This is important when your tenant also has a broader catch-all or forwarding rule. Without **Stop processing more rules**, the Codey message can match your Codey rule first and then continue into another broader rule, causing the message to be forwarded or redirected somewhere else instead of remaining in the Codey mailbox.

Recommended behavior for the Codey-specific rule:

- Match the Codey prefix, for example `codey*@contoso.com`
- Deliver or redirect to the Codey mailbox you configured
- Enable **Stop processing more rules**
- Place the rule above broader catch-all rules when possible

### 5. Optional JSON config

Instead of environment variables, you can provide a JSON file:

```json
{
  "browser": {
    "headless": false,
    "slowMo": 0,
    "defaultTimeoutMs": 15000,
    "navigationTimeoutMs": 30000
  },
  "openai": {
    "baseUrl": "https://openai.com",
    "chatgptUrl": "https://chatgpt.com"
  },
  "exchange": {
    "mailbox": "codey-shared@contoso.com",
    "auth": {
      "mode": "client_credentials",
      "tenantId": "your-tenant-id",
      "clientId": "your-app-client-id",
      "clientSecret": "your-app-client-secret"
    },
    "mailFlow": {
      "catchAll": {
        "prefix": "codey"
      }
    }
  }
}
```

## Browser support

Codey supports only Patchright Chrome.

- Install it with `pnpx patchright install chrome`
- Codey launches Patchright with `channel: "chrome"`
- No custom browser path configuration is required

## Usage

### OpenAI flow commands

```bash
pnpm exec tsx src/cli.ts flow openai-home
pnpm exec tsx src/cli.ts flow chatgpt-entry
pnpm exec tsx src/cli.ts flow chatgpt-open --waitMs 300000
pnpm exec tsx src/cli.ts flow chatgpt-register-exchange --verificationTimeoutMs 180000 --createPasskey true
pnpm exec tsx src/cli.ts flow chatgpt-register-exchange --createPasskey true --sameSessionPasskeyCheck true
pnpm exec tsx src/cli.ts flow chatgpt-login-passkey
```

### Persisted ChatGPT identities

`chatgpt-register-exchange` now saves the generated ChatGPT identity to:

```text
C:\Users\Summp\Documents\GitHub\codey\.codey\credentials\chatgpt-identities.json
```

The saved record includes:

- ChatGPT email
- Account password
- Registration metadata such as prefix and mailbox
- Virtual WebAuthn passkey credentials when passkey provisioning succeeds

You can later try signing in with the stored identity:

```bash
pnpm exec tsx src/cli.ts flow chatgpt-login-passkey
pnpm exec tsx src/cli.ts flow chatgpt-login-passkey --email stored-address@example.com
pnpm exec tsx src/cli.ts flow chatgpt-login-passkey --identityId <saved-identity-id>
```

The login flow prefers the saved passkey when present. If the passkey prompt is unavailable, it falls back to the saved password so the flow can still attempt to complete sign-in.

### Exchange commands

Verify Exchange access:

```bash
pnpm exec tsx src/cli.ts exchange verify
```

List folders:

```bash
pnpm exec tsx src/cli.ts exchange folders
```

List messages from Inbox:

```bash
pnpm exec tsx src/cli.ts exchange messages --maxItems 20
```

List unread messages from a specific folder:

```bash
pnpm exec tsx src/cli.ts exchange messages --folderId <folder-id> --unreadOnly true
```

## Available CLI options

Common options for `flow` and `exchange` commands:

- `--config <file>`: Load configuration from a JSON file
- `--profile <name>`: Reserved for future profile support
- `--headless <bool>`: Override browser headless mode
- `--slowMo <ms>`: Override browser slow motion delay

Flow-specific options:

- `--verificationTimeoutMs <ms>`: How long `chatgpt-register-exchange` waits for the email verification code
- `--pollIntervalMs <ms>`: How often `chatgpt-register-exchange` polls Exchange for the verification code
- `--password <password>`: Override the generated password for `chatgpt-register-exchange`
- `--createPasskey <bool>`: Whether `chatgpt-register-exchange` should provision a passkey
- `--sameSessionPasskeyCheck <bool>`: After registration, try a same-session passkey re-login diagnostic in the same browser/authenticator context
- `--email <email>`: Select a stored identity for `chatgpt-login-passkey`
- `--identityId <id>`: Select a stored identity by saved id for `chatgpt-login-passkey`

Exchange-specific options:

- `--folderId <id>`: Mail folder ID
- `--maxItems <count>`: Maximum number of messages to return
- `--unreadOnly <bool>`: Return unread messages only

## Build

```bash
pnpm build
```

## Lint

```bash
pnpm lint
pnpm lint:fix
```

## Troubleshooting

- If Chrome cannot be launched, run `pnpx patchright install chrome` again.
- If Exchange commands fail with an authentication error, verify the tenant ID, client ID, and client secret.
- If Exchange commands fail with authorization errors, confirm Microsoft Graph application permissions were added and admin consent was granted.
- If mailbox queries fail, verify `EXCHANGE_MAILBOX` points to a mailbox your app is allowed to access.
- If Exchange message tracing shows the message arrived but Codey cannot read it, check whether a broader mail-flow rule forwarded it after the Codey rule matched. In that case, enable **Stop processing more rules** on the Codey-specific rule.
