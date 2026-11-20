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
| Independent app identity | Implemented | com.samurai.whatsapp; does not replace official WhatsApp |
| Custom interface | Implemented foundation | Local control screen with archive, vault, import, status, timeline, App Lock and VPN controls |
| Explicit notification consent | Implemented | Opens Android Notification Access settings |
| WhatsApp / Business filtering | Implemented | Runtime package allowlist in the listener |
| Package visibility for VPN target detection | Implemented in branch; CI pending | Manifest queries only com.whatsapp and com.whatsapp.w4b; no broad QUERY_ALL_PACKAGES |
| MessagingStyle text extraction | Implemented | AndroidX MessagingStyle plus standard text fallbacks |
| Local encrypted notification archive | Implemented in branch; CI pending | AES-256-GCM, Android Keystore key; max 200 records |
| Pause/resume and clear archive | Implemented | User switch; clear retires the archive encryption key |
| Encrypted Media Vault | Implemented in branch; CI pending | SAF-selected image/video/audio; AES-GCM + Keystore; encrypted metadata; export/delete/clear; max 100 files, 250 MiB/file, 1 GiB total |
| Official WhatsApp chat-export import | Implemented in branch; CI pending | User-selected TXT/ZIP; preview; multiline/locale-aware parser; encrypted archive; source-hash dedupe; max 20 MiB source, 24 MiB transcript, 20,000 messages/export, 100 exports; ZIP media not extracted |
| Status Saver | Implemented in branch; CI/device pending | SAF-selected WhatsApp/Media or .Statuses tree; lists max 300 cached image/video files; manual import into Media Vault; no hidden/unviewed/View Once access |
| Message Timeline | Implemented in branch; CI pending | AES-GCM local event ledger, max 500; currently records only notification capture and user chat-export import; no real read/presence adapter |
| App Lock | Implemented in branch; CI pending | Android biometrics or device credential; re-auth on launch and after 30 seconds in background; no PIN/biometric data stored by SAMURAI |
| Screenshot/app-preview protection | Implemented in branch; CI pending | Android FLAG_SECURE while App Lock is enabled |
| Per-app network block (VPN) | Implemented in branch; runtime/device pending | Explicit Android VPN consent; allowlists only WhatsApp package UIDs; drops packets locally; not Always-on/Lockdown and fail-open if service stops |
| Anti-Delete | Partial | A notification copy may survive later deletion only if Android first posts visible text; cannot guarantee hidden previews, muted/suppressed notifications, truncation or absent notifications |
| One Tick / Hide Delivered | Experimental candidate; not implemented | Separate recipient-side rooted lab module, dedicated test number, exact host-version checks and second-device verification; no anti-ban guarantee |
| Read Tracker for personal outgoing messages | Not implemented for personal WhatsApp; status reducer added | `MessageStatusReducer` now models verified server/device/read/played evidence for SAMURAI-owned messaging and supported integrations; it rejects untrusted sources and keeps missing signals UNKNOWN. No personal WhatsApp receipt source is connected. |
| Exact personal read timestamp | Not available | Timeline does not infer read time; local observed-at time is not the recipient's server-side read time |
| Business API read timeline | Feasible only for API-originated messages | Meta Business Platform status webhooks apply to outbound messages sent through that API; not personal-account tracking |
| Last Seen / Online Tracker | Not implemented; disclosure-bound | Presence is not collected; future tracking may only record disclosed presence; hidden state remains unknown |
| Hide Blue Read Receipts / Typing / Recording | Companion-blocked; experimental candidate | Notification access cannot alter WhatsApp protocol acknowledgements or internal presence |
| Anti-View Once | Not implemented; protected-media bypass excluded | App does not extract or reopen View Once media |
| Themes / custom fonts | Not implemented | Current UI is a dark local control screen; no full theme/font engine |
| Network/backend sync | Intentionally absent | No INTERNET permission, analytics, cloud sync or backend connector |

## Signal and privacy rules

1. Never convert a missing delivery/read/presence event into a positive or negative claim.
2. Use `UNKNOWN` / `UNAVAILABLE` when WhatsApp or Android does not expose a signal.
3. Never present a local observation timestamp as the recipient's exact read time.
4. Record source provenance for every event: Android notification, official Business API webhook, or isolated lab session.
5. Personal read receipts and presence remain subject to the other contact's privacy settings and WhatsApp's reciprocity rules.
6. Do not implement scraping or hidden-state extraction to defeat those settings.

## Verification gates

1. Gradle compiles both Android applications.
2. WhatsApp companion APK contains DEX classes for MainActivity, listener, archive, Media Vault, export importer/archive, Status Saver, Message Timeline, App Lock and VPN service; workflow asserts these classes and the two narrow package visibility entries.
3. Android emulator instrumentation tests verify archive, Media Vault, chat-export parser, Timeline provenance, Status Saver MIME/folder logic, App Lock preferences and VPN service manifest/state. The latest recorded attempt failed before any test started because the emulator instrumentation process crashed (0/0 completed); this is not a passing test result.
4. The latest Actions run must complete instrumentation tests and upload both APK artifacts. A previous build/DEX success is not sufficient.
5. Real Samsung Galaxy A54 test verifies notification access, actual WhatsApp preview delivery, pause/clear, Media Vault import/export/delete, .Statuses folder access, App Lock re-authentication and VPN on/off behavior.
6. Any future One Tick research is tested on a separate lab device/account against a second physical device; no primary-account install or root.

Do not mark gate 5 or 6 successful based on CI or emulator evidence. The current Android emulator failure is an instrumentation-process failure with 0/0 tests completed, not an assertion failure in an identified test.

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

## Receipt display policy update (2026-11-17)

`ReceiptDisplayPolicy` now supports `ALWAYS_SINGLE_TICK` for SAMURAI-owned message views. This masks the local icon only and retains the verified underlying status; it does not change WhatsApp delivery/read network receipts, does not make a recipient see one tick, and is not yet wired to a WhatsApp conversation UI. The Android instrumentation suite includes tests for masking, standard verified status, unknown status, and evidence preservation. A separate WhatsApp client integration remains unimplemented and requires a version-pinned, isolated compatibility study; no hooks are installed into the user's primary WhatsApp.
