# Capability feasibility audit

**Last reviewed:** 2026-11-15  
**Research detail:** see [competitive research and build plan](research-and-build-plan.md).

Status labels:
- **Implemented** — code exists in the feature branch.
- **CI-verified** — the latest relevant CI run completed successfully.
- **Device pending** — requires a real target-device test.
- **Partial** — useful but incomplete signal or workaround.
- **Companion-blocked** — cannot be provided by this app through supported Android APIs.
- **Experimental candidate** — similar behavior is claimed by public client-hook projects; not implemented or validated by SAMURAI.

| Requirement | Current status | Evidence / limitation |
|---|---|---|
| Independent app identity | Implemented | `com.samurai.whatsapp`; does not replace official WhatsApp |
| Custom interface | Implemented foundation | Local control screen, status, notification archive and Media Vault list/actions |
| Explicit notification consent | Implemented | Opens Android Notification Access settings |
| WhatsApp / Business filtering | Implemented | Package allowlist in listener |
| MessagingStyle text extraction | Implemented | AndroidX NotificationCompat MessagingStyle plus standard text fallbacks |
| Local encrypted notification archive | Implemented; CI validation pending | AES-256-GCM, Android Keystore key |
| Pause/resume archiving | Implemented | Local switch; listener checks flag before persistence |
| Clear notification archive | Implemented | User-confirmed local deletion and archive-key retirement |
| Notification retention limit | Implemented | Maximum 200 records |
| **Encrypted Media Vault** | **Implemented in branch; CI pending** | Android system document picker; app-private encrypted file storage; AES-GCM and Android Keystore; encrypted metadata; image/video/audio only; export/delete/clear; max 100 files, 250 MiB per file and 1 GiB total; import/export runs off the UI thread; no broad storage permission |\n| **Official WhatsApp chat-export import** | **Implemented in branch; CI pending** | User-selected `.txt` / `.zip`; parser for common bracketed and dashed timestamp formats; multi-line messages; locale fallback; preview before save; encrypted AES-GCM archive/index; source-hash dedupe; list/read/delete/clear; max 20 MiB source, 24 MiB normalized transcript, 20,000 messages/export and 100 exports. ZIP import parses the TXT transcript only; media entries are not extracted automatically. No WhatsApp private database access. |
| Anti-Delete | Partial | A notification copy may survive later deletion, but only if Android posts visible text first; no guarantee for hidden previews, muted/suppressed notifications, truncation or absent notifications |
| **One Tick / Hide Delivered** | **Experimental candidate; not implemented** | Public Xposed projects claim Hide Delivered / receipt control. This cannot be delivered by the current companion app. Research hypothesis: a recipient-side client module changes acknowledgements sent by the local account. It requires a separate rooted lab device, dedicated test number, exact host-version checks and second-device validation. No anti-ban guarantee. |
| Read Tracker for personal outgoing messages | Partial / signal-dependent | Unofficial Web-session engines document SERVER, DEVICE, READ and PLAYED acknowledgements. Missing READ is UNKNOWN, not proof of unread; privacy settings and protocol changes can suppress or remove signals. |
| Exact personal read timestamp | Not guaranteed | A local webhook-observation time is not automatically the exact server-side read time. Preserve source timestamp only when the source supplies one; otherwise label `observed_at`. |
| Business API read timeline | Feasible for API-originated messages | Meta Business Platform can send sent/delivered/read status webhooks for messages sent through that API. It is not a universal personal WhatsApp tracking API. |
| Last Seen / Online Tracker | Partial / disclosure-bound | WAHA exposes presence events when the contact shares presence. Official WhatsApp privacy rules are reciprocal. Hidden states must remain `unknown / unavailable`. |
| Hide Blue Read Receipts | Companion-blocked; experimental candidate | Current companion cannot change WhatsApp protocol acknowledgements. Public Xposed projects list related controls, but SAMURAI has not implemented or tested them. |
| Hide Typing / Recording | Companion-blocked; experimental candidate | Notification access cannot alter WhatsApp's internal presence state. Public Xposed projects list related controls, but functionality is version-dependent. |
| Anti-View Once | Not implemented; protected-media bypass excluded | NotificationListenerService does not receive View Once media bytes. SAMURAI may import media the user can normally access or share; it will not claim to bypass View Once protections. |
| Status Saver | Future; feasible with user-granted access | Public projects demonstrate browsing media already cached locally after the user viewed a status. Implement using Storage Access Framework, not broad all-files permission. |
| Per-app Internet Kill Switch | Future; technically feasible with explicit VPN consent | A local VPN can filter app traffic but is disruptive and does not guarantee a particular tick or receipt state. It may interrupt messaging, calls and backups. |
| Themes / fonts / app lock | Future | Fully feasible inside the SAMURAI companion app; does not restyle the official WhatsApp client without a separate hook module. |
| Network/backend sync | Intentionally absent in current app | No Internet permission or backend integration in the companion. |

## Signal and privacy rules

1. Never convert a missing delivery/read/presence event into a positive or negative claim.
2. Use `UNKNOWN` / `UNAVAILABLE` when WhatsApp or Android does not expose a signal.
3. Never present a local observation timestamp as the recipient's exact read time.
4. Record source provenance for every event: Android notification, official Business API webhook, or isolated lab session.
5. Personal read receipts and presence remain subject to the other contact's privacy settings and WhatsApp's reciprocity rules.
6. Do not implement scraping or hidden-state extraction to defeat those settings.

## Verification gates

1. Gradle compiles both Android applications.
2. WhatsApp companion APK contains MainActivity, WhatsAppNotificationListener, NotificationArchive, MediaVault and WhatsAppExportImporter/Archive DEX classes.
3. Android emulator tests verify notification archive encryption/retention, Media Vault encryption round-trip/plaintext absence/MIME rejection/delete/re-key, and chat-export TXT/ZIP parsing, locale timestamp fallback, multi-line handling, source dedupe, encrypted restore/delete/clear.
4. The latest Actions run finishes emulator instrumentation tests and uploads artifacts. A previous build-only success is not sufficient.
5. Real Samsung Galaxy A54 test verifies notification access, actual WhatsApp preview delivery, archive display, pause/clear, Media Vault import/export/delete.
6. Any future One Tick research is tested on a separate lab device/account against a second physical device; no primary-account install or root.

Do not mark gate 5 or 6 successful based on CI or emulator evidence.

## Research decision

**GO:** continue the independent companion, encrypted notification archive, encrypted user-selected Media Vault, official user-export importer, event ledger with explicit provenance, cached Status Saver, and optional official Business API webhook connector.

**LAB-ONLY:** investigate One Tick / Hide Delivered through public Xposed/LSPosed research. Keep it a separate build identity and test branch. Require rooted spare hardware, dedicated number, compatibility guard, source/dependency/license audit and rollback plan.

**NO-GO:** root/LSPosed on the primary Galaxy A54, repackaged WhatsApp APKs, hidden-presence scraping, bypassing another user's privacy settings, or any unverified anti-ban claim.

## Sources

- Competitive research and build plan: [research-and-build-plan.md](research-and-build-plan.md)
- Android NotificationListenerService: https://developer.android.com/reference/android/service/notification/NotificationListenerService
- AndroidX MessagingStyle: https://developer.android.com/reference/androidx/core/app/NotificationCompat.MessagingStyle
- Android Storage Access Framework: https://developer.android.com/guide/topics/providers/document-provider
- WhatsApp privacy settings: https://faq.whatsapp.com/3307102709559968/
- WhatsApp last seen and online: https://faq.whatsapp.com/419827870318306/
- WhatsApp warning about unofficial apps: https://faq.whatsapp.com/1217634902127718/
- WhatsApp temporary bans / scraping: https://faq.whatsapp.com/1848531392146538/
- WhatsApp Business Platform overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/overview
- Meta Postman collection — message status update notifications: https://www.postman.com/meta/whatsapp-business-platform/request/rgtfq23/message-status-update-notifications
- WaEnhancerX: https://github.com/WaEnhancerX/WaEnhancerX
- WaToolkit: https://github.com/kherio/WaToolkit
- Wa Enhancer: https://github.com/Xposed-Modules-Repo/com.wmods.wppenhacer
- WAHA presence: https://waha.devlike.pro/docs/how-to/presence/
- WAHA events: https://waha.devlike.pro/docs/how-to/events/
