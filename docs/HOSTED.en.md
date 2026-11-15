# Official hosted service

[简体中文](HOSTED.md) · [Project home](../README.en.md) · [Local user manual, Chinese](wiki/README.md)

The official MeWiki service is **[https://wiki.mecore.cc](https://wiki.mecore.cc)**. Open it in your browser to try the application, or sign in with MeAccount to manage your online libraries.

## Access and accounts

| Entry | URL | Purpose |
| --- | --- | --- |
| Official homepage | [wiki.mecore.cc](https://wiki.mecore.cc) | Sign-in and temporary guest access |
| Online workspace | [wiki.mecore.cc/workspace](https://wiki.mecore.cc/workspace) | Edit and manage data after sign-in |
| MeAccount profile | [accounts.mecore.cc/profile/](https://accounts.mecore.cc/profile/) | Shared avatar and profile |

The sign-in link redirects to MeAccount and returns you to MeWiki after authentication. Account access is currently controlled; check the actual sign-in page for registration options. MeAccount manages identity; MeWiki stores notes and libraries. The shared avatar is used by official products that have integrated it.

## Try a temporary guest space

Choose “立即体验” (Try now) on the homepage to create an isolated guest identity and space. Tabs in the same browser can reuse the space; other guests cannot read its content.

- A space lasts up to **2 hours** and expires after **30 minutes of inactivity**. Expired data is automatically cleaned up.
- It allows **20 notes and 5 MiB of current content**, without attachment uploads. The page shows the applicable limits.
- Use it to try editing, dictionaries, and maps. Export anything you want to keep before expiry.
- Signing in switches to a regular space. **Guest content is not automatically merged**, and the regular account does not gain access to the guest space.

## Local and hosted scope

| Capability | Local version in this repository | Official hosted service |
| --- | --- | --- |
| Identity and access | Runs on your machine, no account required | MeAccount sign-in; separate temporary guest access |
| Notes, dictionaries, formulas, maps | Available | Available |
| Storage | Browser or your chosen local directory | Server storage isolated by account, workspace, and library |
| Attachments, history, JSON / ZIP backups | Available | Regular accounts, subject to hosted quotas |
| Offline editing | Available after installation | Requires a connection to the service |
| Your own AI services, skills, and review | Available | Not yet available |
| Plugin installation and local directory / font services | Available | Not yet available |
| Web / DOI metadata fetching | Available | Not yet available |
| Automatic local / hosted two-way sync | Not available | Not available |

The public repository maintains the local application and shared note core. Account integration, online storage, and production deployment are maintained in a separate server edition. This public repository does not currently include a complete multi-user self-hosting backend. Features will evolve; use the controls offered by each version.

## Data and backups

Regular hosted notes and history are stored in the server database; attachments are stored by the server. The browser displays content and keeps local caches. Signing out or changing devices does not turn saved hosted data into local files. The service uses HTTPS, authentication, and server authorization to isolate users' data; end-to-end encryption is not currently implemented.

Current regular-space attachment limits are **32 MiB per file and 256 MiB per library**. Backup import also checks content size, attachment references, and change counts before confirmation. For large backups, organize smaller libraries locally first and follow the validation messages.

Use Settings → Backup and restore to export JSON or a ZIP with attachments. **ZIP is suitable for a complete move; JSON contains structure and attachment references only.** Remote URLs are not automatically downloaded into the backup. The service is still evolving; keep independent backups of important data.

## Move a local library online

1. Confirm the local library is saved. In local Settings → Backup and restore, export a **ZIP backup with attachments**.
2. Open [wiki.mecore.cc](https://wiki.mecore.cc) and sign into a regular MeAccount account. Guest spaces are not intended for attachment migration.
3. Create or select a destination library online. **Its name may differ from the local name**; the selected library is the restore destination.
4. Back up any existing destination content first. In hosted Settings → Backup and restore, select the local ZIP, review validation and preview, then explicitly confirm import.
5. Wait for saving to finish and check notes, dictionaries, maps, and attachments. The online library keeps its own history; local history is not imported as online history.

Restore **replaces the destination's current content**; it does not automatically merge two libraries. Choose ZIP for notes with images, PDFs, or other original attachments. After import the two libraries remain independent, with no automatic sync. Export and restore backups to move content in the opposite direction as well.

If import fails, retain the local library and backup, and check the page's validation or quota message. Report reproducible issues through [GitHub Issues](https://github.com/tojayon/MeWiki/issues) using steps and sanitized error messages. Do not publish personal backups, login details, or private content.
