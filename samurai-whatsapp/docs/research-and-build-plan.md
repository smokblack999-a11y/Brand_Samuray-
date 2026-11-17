# SAMURAI WhatsApp Hybrid — Competitive Research & Build Plan

**Research snapshot:** 2026-11-15  
**Target branch:** `feat/samurai-whatsapp-hybrid-v1`  
**Scope:** public repositories, vendor documentation, Android APIs, WhatsApp/Meta documentation. This is a reproducible public-source review, not a claim that every project on the internet has been exhaustively inspected.

## 1. Executive findings

There are existing implementations for several requested capabilities:

- **Hide Delivered / receipt control:** publicly described by WaToolkit and Wa Enhancer; WaEnhancerX describes granular control over delivered and read receipts.
- **Anti-delete archive:** several Android apps use NotificationListenerService to preserve notification text before a later deletion.
- **Status/media saver:** projects such as LibreStatus and WASSaver read media that WhatsApp has already cached locally, with user-granted storage access.
- **Presence and acknowledgement event collection:** WAHA exposes message acknowledgement events and presence events through unofficial WhatsApp Web engines.
- **Official delivery/read timeline:** WhatsApp Business Platform provides status webhooks for messages sent through the Business Platform API.

No reviewed source establishes a supported way to obtain another person's hidden read receipts, last-seen or online state. The official WhatsApp privacy rules are reciprocal: disabling one's own read receipts prevents seeing other users' read receipts; hiding one's own last-seen/online also restricts what one can see.

**Product decision:** retain the independent companion app as the safe/default product; keep any runtime-hook experiment separate, opt-in, and lab-only. Do not replace or patch the user's primary WhatsApp installation.

## 2. Competitive landscape

| Project / source | Relevant capabilities described by its maintainers | Requirements and caveats | SAMURAI use |
|---|---|---|---|
| [WaEnhancerX](https://github.com/WaEnhancerX/WaEnhancerX) | Anti-delete, view-once tools, receipt control for blue ticks and delivered receipts, UI customization | Xposed/LSPosed module; requires rooted device and compatible host version. README calls it a proof-of-concept/research project and warns of account, data-loss and device risks. Its public tree also declares a required private `:licensing` module and signing key, so a public clone alone does not produce the configured APK. | Study architecture and compatibility gates. Do not copy blindly or assume features work on every WhatsApp build. |
| [WaToolkit](https://github.com/kherio/WaToolkit) | Hide Delivered, Hide Blue Ticks, Freeze Last Seen, Hide Typing/Recording, Anti-Revoke, View Once-related controls | Xposed module; root + LSPosed recommended by its README; under development; GPL-3.0. It is a fork of Dev4Mod/WaEnhancer. | Feature comparison only until GPL obligations and host-version compatibility are reviewed. |
| [Wa Enhancer](https://github.com/Xposed-Modules-Repo/com.wmods.wppenhacer) | Hide Delivered, Hide Blue Ticks, Freeze Last Seen, Hide Typing/Recording, Anti-Revoke, UI changes | Xposed module; GPL-3.0; README says development/bugs may occur. | Independent second source showing the same general feature family; not proof of stable operation. |
| [WAHA](https://waha.devlike.pro/) | REST API, webhooks, multiple engines, message events, message ACKs, presence subscriptions | Uses unofficial WhatsApp Web engines. Presence documentation explicitly says it is available only when the contact shares presence information. This is not a supported personal-client API. | Optional isolated test harness for event-model research; never a hidden-status bypass and never the primary-account default. |
| [Baileys](https://github.com/WhiskeySockets/Baileys) / [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) / [WPPConnect](https://github.com/wppconnect-team/wppconnect) / [whatsmeow](https://github.com/tulir/whatsmeow) | Unofficial multi-device/Web client protocol libraries or browser-driven client automation | Reverse-engineered, non-official integrations; protocol and account compatibility can change. | Review only behind a separate connector interface and dedicated test account. No production dependency by default. |
| [WhatsApp Archive / Message Memory](https://github.com/Theabidchaudhary/WhatsApp-Archive) | Local notification archive, deleted-message preservation from notification text, privacy-first/no-network design | NotificationListenerService only receives Android notification content; it does not expose WhatsApp's private database or all media. | Validate and improve our existing encrypted notification archive, retention controls and device tests. |
| [NotificationExplorer / My WhatsApp](https://github.com/sinpin/NotificationExplorer) | Notification capture plus import of official WhatsApp `.txt` / `.zip` chat exports; local Room archive, chat UI and duplicate-safe re-import are described | Repository README itself says the project was not compiled in its authoring environment. License was not verified during this review. Export parsing is language/locale-sensitive; imports are user-selected. | Best next safe reference for importing a user's own official chat-export archive; clean-room parser, explicit preview, locale fixtures and encrypted storage. |
| [Recal / Notification Recorder](https://github.com/aminechraibi/Notification-Recorder) | Notification recorder, chat threading, deduplication, local archive | Depends on notifications being posted with visible previews. | Study deduplication and conversation grouping patterns. |
| [WASSaver-Android](https://github.com/PBhadoo/WASSaver-Android) | Status saver, deleted-message capture, media browser, local notification history | Uses NotificationListenerService plus media/storage access; its documented permissions include media access and update-check networking. | Study UI/media organization; prefer our stricter permission model and SAF. |
| [LibreStatus](https://github.com/vaishnav-mandlik/LibreStatus) | Offline status browser/saver, no network/ads/trackers | Reads status media already cached on the device after the user viewed the status; uses Android Storage Access Framework on newer Android versions. | Best low-risk reference for a user-selected local Media Vault / Status Saver. |

### Important source-quality distinction

A README feature list is evidence that a maintainer claims a feature, not proof of correctness or compatibility. WaEnhancerX's own architecture notes distinguish successful hook registration from actual device behavior and require exact host-version checks. Its current public docs describe a rooted Xposed setup, target-version gates, and device acceptance requirements. These standards should be adopted by SAMURAI.

## 3. Feature-by-feature feasibility

| SAMURAI requirement | What already exists | Feasibility and correct boundary | Planned track |
|---|---|---|---|
| **One Tick / Hide Delivered (P0)** | WaToolkit explicitly lists Hide Delivered; Wa Enhancer lists Hide Delivered; WaEnhancerX lists granular delivered-receipt control. | This is not achievable by our current companion app. The likely implementation class is a recipient-side client hook that changes which delivery/read acknowledgements the local account emits. The module must be active on the account/device receiving messages; the sender's phone cannot independently suppress acknowledgements generated by another person's phone. Exact behavior must be confirmed on a dedicated lab number and exact WhatsApp build. | Separate experimental module track only. No root or hook installation on the primary phone. |
| **Read Tracker / Read Time for messages we send (P1)** | WAHA documents `message.ack` states: SERVER, DEVICE, READ and PLAYED. Meta documents sent/delivered/read status webhooks for Business Platform API messages. | These are observable signals, not a universal guarantee. A missing READ event means unknown/not exposed, not proof that the user did not read. WAHA event observation time is not automatically the exact server-side read time. Cloud API status timestamps are the stronger timestamp source, but apply to messages sent through that API. | Build a provenance-aware Message Timeline. Support official Business API status events as a separate business mode; treat personal-client signals as unavailable unless actually observed. |
| **Last Seen / Online Tracker** | WAHA exposes `presence.update`, `lastKnownPresence`, and `lastSeen`. | WAHA's docs explicitly limit returned presence to contacts who share it. WhatsApp's official privacy help describes reciprocity and reasons a status may be unavailable. No hidden/private state bypass. | Track only disclosed observations; preserve observed-at time and signal source; show `unknown / unavailable` when absent. |
| **Anti-Delete** | Notification-archive apps use NotificationListenerService. Our branch already implements this pattern. | Partial only: capture requires a posted notification with visible text. Hidden previews, muted/suppressed notifications, grouping, truncation and app/OS behavior can prevent capture. Notification cancellation alone is not proof of delete-for-everyone. | Improve current archive and add real Galaxy A54 validation. |
| **Anti-View Once** | Xposed projects claim view-once controls; Android notification archives do not receive the media bytes. | Do not bypass another sender's View Once restrictions or extract protected media. Supported media import can save files the user is permitted to access or share normally. | Build user-consented Media Vault/import, not a View Once bypass. |
| **Status Saver** | LibreStatus and WASSaver demonstrate local cached-media browsing; SAMURAI implements a manual SAF cached-status browser. | Reads only the user-selected WhatsApp/Media or .Statuses tree; lists up to 300 cached image/video files; saves a selected item into encrypted Media Vault. Device/SAF-provider behavior still needs validation. | Implemented in Track A; no hidden/unviewed/View Once access or broad all-files permission. |
| **Typing / Recording privacy** | Xposed projects list hide typing/recording. | Companion APIs cannot modify WhatsApp's internal state. Do not promise hidden-state control through Android notification access. | Only in a separately assessed client-hook experiment, if ever. |
| **Media Vault** | SAMURAI implementation exists in the feature branch. | User-selected images/video/audio are encrypted in app-private storage; export/delete/clear are supported. Automated test suite awaits a successful emulator run and physical-device checks. | Implemented in Track A; validate on emulator and Galaxy A54. |
| **Per-app network block (VPN)** | SAMURAI implements a user-consented VpnService with an allowlist for WhatsApp package UIDs and local packet discard. | It blocks traffic only while the service is active, can interrupt messages/calls/backups, does not inspect/forward payloads, and is fail-open if Android stops the service. It is not Always-on/Lockdown and does not guarantee a tick/receipt state. | Implemented in Track A; add manifest/state tests and validate runtime on a physical device. |
| **Themes, font, app lock** | App Lock uses Android biometrics/device credential and applies FLAG_SECURE while enabled; a full theme/font engine is not implemented. | The lock protects the SAMURAI companion only and relies on the device's configured screen lock. It does not lock or restyle official WhatsApp. | App Lock implemented in Track A; themes/fonts remain future work. |

## 4. One Tick engineering hypothesis and acceptance test

The feature name "Hide Delivered" in existing Xposed projects is the closest public precedent. The working hypothesis is that a recipient-side module selectively suppresses delivery/read acknowledgement emission by the local account. This is a hypothesis to validate, not a claim about the internals of any particular project.

A proper lab test must distinguish at least:

1. Message sent to the test account while its phone is offline.
2. Message delivered after the test account reconnects.
3. Notification visible but chat not opened.
4. Chat opened and message read.
5. App backgrounded, force-stopped and restarted.
6. Linked-device session active and inactive.
7. One-to-one text, media and group conversations.
8. Read receipts enabled/disabled, with delivery suppression toggled independently.
9. Outgoing messages from the same test account, to verify whether peer READ acknowledgements remain observable.
10. WhatsApp version update, rollback and module incompatibility behavior.

Acceptance criteria:

- The sender-side tick state is checked on a second physical test device, not inferred from local UI.
- The feature has explicit ON/OFF state and a diagnostic showing the exact tested host version.
- Unsupported versions fail closed; no generic version bypass.
- Any app crash, account warning, lost message, unexplained state mismatch or update incompatibility is a stop condition.
- No claim of "anti-ban" or guaranteed account safety.

**Critical placement:** the One Tick module belongs on the SAMURAI user's receiving endpoint/account. It cannot reach into the recipient's phone for a message sent by the user. For messages sent by the user, Read Tracker is a separate inbound acknowledgement path. Whether these two paths can coexist on one account without reducing read visibility is an explicit lab test.

## 5. Read Intelligence design

Use an event ledger, not a guessed status field.

Suggested event types:

- `OUTGOING_CREATED`
- `SERVER_ACCEPTED`
- `DEVICE_DELIVERED`
- `READ_CONFIRMED`
- `MEDIA_PLAYED`
- `INCOMING_NOTIFICATION_CAPTURED`
- `PRESENCE_ONLINE_OBSERVED`
- `PRESENCE_OFFLINE_OBSERVED`

Every event must include:

- `message_id` or a local correlation key;
- `source` (`ANDROID_NOTIFICATION`, `WHATSAPP_CLOUD_API`, or `LAB_WEB_SESSION`);
- `event_time` only when supplied by the source;
- `observed_at` local timestamp;
- `confidence` / provenance;
- optional peer identifier stored encrypted and locally.

Rules:

- Never convert "no event received" into "not read".
- Never infer last-seen time from notification delivery time.
- Never display local observation time as the recipient's exact read time.
- Deduplicate webhook retries and tolerate out-of-order status events.
- Preserve an explicit `UNKNOWN` state.
- Cloud API status events are valid only for the message IDs sent through that Business API integration.

## 6. Licenses and reuse policy

- WaEnhancerX declares Apache-2.0, but the reviewed public source also requires a private `:licensing` module and configured signing key for the complete APK build. We can study architectural patterns; before copying any code, review the exact file headers, third-party dependencies, and private-module boundaries, and preserve Apache notices/attribution.
- WaToolkit, the cited Wa Enhancer repository and MdgWa declare GPL-3.0. Do not transplant code into a differently licensed SAMURAI deliverable without a deliberate GPL-compatible distribution decision and release-source obligations review.
- LibreStatus declares MIT; this is a more permissive reference for the cached Status Saver design. NotificationExplorer's license was not verified in this review, so treat it as a design reference only and do not copy its code until its license is confirmed.
- AMWss/WaEnhancer's README lists multiple advanced privacy features, but its license and full build/runtime requirements were not verified here. No code from it is copied.
- Do not redistribute WhatsApp APKs, private WhatsApp code, keys, account tokens, or patched binaries.
- Prefer clean-room implementation of independently derived ideas where code reuse is not essential.

## 7. SAMURAI target architecture

### Track A — Safe companion (current product)

`SAMURAI WhatsApp Android app → local privacy/settings center → encrypted notification archive → encrypted Media Vault → official user-export importer → SAF Status Saver → provenance-aware encrypted Timeline`

- Keep package `com.samurai.whatsapp` separate from WhatsApp.
- No WhatsApp account credentials or session keys.
- Keep NotificationListenerService opt-in and document its OS-level sensitivity.
- Use SAF/Photo Picker for user-selected media and cached statuses.
- App Lock uses the system biometric/device credential and FLAG_SECURE; SAMURAI never stores a PIN or biometric template.
- Optional local VPN block requires explicit Android consent, drops only WhatsApp package traffic while active, is not Always-on/Lockdown and is fail-open if the service stops.
- The companion has no INTERNET permission or backend sync.
### Track B — Official Business integration (optional)

`SAMURAI Core → WhatsApp Cloud API → verified HTTPS webhook → signature validation → event ledger`

- Use only the official Meta Business Platform.
- Track status only for outbound messages sent through the Cloud API.
- Validate webhook authenticity, deduplicate retries, preserve source timestamps, and store access tokens only in server-side secrets.
- This is a business messaging mode, not a way to inspect a personal WhatsApp account.

### Track C — Isolated compatibility lab (not production)

- Separate branch and build identity from Track A.
- Dedicated spare rooted device, dedicated test number and test contacts.
- Static analysis, dependency/license review, exact package/version allowlist, runtime diagnostics, and rollback procedure.
- No changes to the primary Galaxy A54/primary WhatsApp installation.
- No scraping of hidden presence or read states, no anti-ban claim, no stealth collection.

## 8. Build order and gates

| Priority | Deliverable | Completion gate |
|---|---|---|
| Priority | Deliverable | Completion gate |
|---|---|---|
| P0 | Stabilize Android emulator CI and validate instrumentation suite | Emulator completes all tests; APK artifacts upload; collect logcat on failure. Previous attempt crashed before any test began (0/0). |
| P0 | Validate Notification Archive on Galaxy A54 | Manual test confirms notification capture, pause/resume and clear/key retirement. |
| P0 | Validate encrypted Media Vault and official chat-export importer | Emulator tests pass for encrypt/export/tamper/delete/re-key, TXT/ZIP parsing, locale fallback, multiline messages, encrypted restore, dedupe, delete and clear; then test real user-selected files/exports on Galaxy A54. ZIP media extraction remains separate. |
| P0 | Validate Status Saver and App Lock | SAF folder permission, cached status list/save, biometric/device credential flow, 30-second re-lock and FLAG_SECURE behavior on Galaxy A54. |
| P0 | Validate per-app VPN block | Manifest/DEX/instrumentation checks, then real-device on/off test confirming only WhatsApp package traffic is dropped; test restore after service stop/revoke. Do not label it fail-closed. |
| P1 | Complete provenance-aware Message Timeline | Tests prove unknown states remain unknown and source timestamps stay separate from observed-at. Personal READ/presence adapters remain unavailable. |
| P2 | Optional Cloud API webhook connector | Signature validation, status timestamp tests, retry dedupe, secret handling and official test number. |
| P3 research | One Tick feasibility lab specification | Dedicated spare rooted device, test number, exact WhatsApp build and second-device validation; primary phone excluded. |
| P4 | Experimental One Tick prototype | Separate build identity; second-device tick verification and explicit account-risk acceptance. |

## 9. Current repository state at research start

- Existing PR: [#141 — SAMURAI WhatsApp Hybrid V1](https://github.com/smokblack999-a11y/Brand_Samuray-/pull/141)
- Branch: `feat/samurai-whatsapp-hybrid-v1`
- Base: `main`
- PR was open, draft, mergeable and not merged at the start of this research snapshot.
- Current feature branch includes encrypted notification archive, encrypted Media Vault, official chat-export importer, Status Saver, encrypted Timeline, App Lock and opt-in per-app VPN network block.
- Latest recorded CI attempt built both apps and passed DEX checks, but emulator instrumentation process crashed before any test started (0/0); APK upload was skipped.
- No Galaxy A54 end-to-end device validation has been performed.

## 10. Sources reviewed

### Official / platform sources
- WhatsApp privacy settings: https://faq.whatsapp.com/3307102709559968/
- WhatsApp last seen and online: https://faq.whatsapp.com/419827870318306/
- WhatsApp unofficial apps warning: https://faq.whatsapp.com/1217634902127718/
- WhatsApp temporarily banned accounts / scraping: https://faq.whatsapp.com/1848531392146538/
- WhatsApp View Once: https://faq.whatsapp.com/1077018839582332
- Meta WhatsApp Business Platform overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/overview
- Meta Postman collection — message status update notifications: https://www.postman.com/meta/whatsapp-business-platform/request/rgtfq23/message-status-update-notifications
- Android NotificationListenerService: https://developer.android.com/reference/android/service/notification/NotificationListenerService
- Android Storage Access Framework: https://developer.android.com/guide/topics/providers/document-provider
- Android package visibility filtering: https://developer.android.com/training/package-visibility
- Android VPN service lifecycle: https://developer.android.com/develop/connectivity/vpn
- Android 14 foreground-service types: https://developer.android.com/about/versions/14/changes/fgs-types-required

### Open-source project sources
- WaEnhancerX README and architecture: https://github.com/WaEnhancerX/WaEnhancerX
- WaEnhancerX architecture source map: https://github.com/WaEnhancerX/WaEnhancerX/blob/main/docs/ARCHITECTURE.md
- WaEnhancerX client compatibility: https://github.com/WaEnhancerX/WaEnhancerX/blob/main/docs/client-compatibility.md
- WaToolkit: https://github.com/kherio/WaToolkit
- Wa Enhancer: https://github.com/Xposed-Modules-Repo/com.wmods.wppenhacer
- WAHA development architecture: https://waha.devlike.pro/docs/how-to/development/
- WAHA presence: https://waha.devlike.pro/docs/how-to/presence/
- WAHA events / message ACK: https://waha.devlike.pro/docs/how-to/events/
- WhatsApp Archive: https://github.com/Theabidchaudhary/WhatsApp-Archive
- Recal / Notification Recorder: https://github.com/aminechraibi/Notification-Recorder
- WASSaver Android: https://github.com/PBhadoo/WASSaver-Android
- LibreStatus: https://github.com/vaishnav-mandlik/LibreStatus
- NotificationExplorer / My WhatsApp: https://github.com/sinpin/NotificationExplorer
- MdgWa: https://github.com/xerta555/MdgWa
- AMWss/WaEnhancer: https://github.com/AMWss/WaEnhancer
- NotificationExplorer / My WhatsApp: https://github.com/sinpin/NotificationExplorer
- MdgWa: https://github.com/xerta555/MdgWa
- AMWss/WaEnhancer: https://github.com/AMWss/WaEnhancer

---

**Status of this document:** research and implementation plan. The feature branch now contains Media Vault, official chat-export import, manual cached Status Saver, encrypted Message Timeline, App Lock and an opt-in per-app VPN network block. Build and DEX verification passed in the last recorded run; emulator instrumentation crashed before any test ran, and physical-device validation is pending. One Tick, personal outgoing Read Tracker and Last Seen/Online collection are not implemented.
