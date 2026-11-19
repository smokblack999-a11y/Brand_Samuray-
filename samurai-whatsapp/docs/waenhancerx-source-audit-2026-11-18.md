# WaEnhancerX source audit and SAMURAI architecture decision

**Reviewed:** 2026-11-18  
**Upstream:** https://github.com/WaEnhancerX/WaEnhancerX  
**Upstream commit/tree:** `0aaffab0270a3d0832bef2895f6457f3792fd74a`  
**Purpose:** distinguish source-level implementation from marketing claims and decide what is appropriate for SAMURAI.

## 1. Findings from upstream public source

The upstream repository is a Kotlin/Java Xposed/LSPosed module targeting WhatsApp and WhatsApp Business. Its README declares Apache-2.0, legacy Xposed API 82, Android API 24+, and a rooted device with a working Xposed-compatible framework.

The public repository is not a self-contained reproducible build: README declares a required private `:licensing` module and original configured signing key. A public clone alone cannot produce the configured APK. SAMURAI must not depend on, copy, or redistribute a prebuilt upstream APK.

Audited source paths and pinned upstream blob revisions:

| Feature area | Source path | Blob SHA | Source-level conclusion |
|---|---|---|---|
| Delivery/read receipt controls | `app/src/main/java/com/waenhancer/xposed/features/privacy/HideReceiptsHook.java` | `bfdc4c7d4ec29429451d4fb3d40f4029641497fa` | Xposed hooks target the local account's outgoing read/delivery receipt paths. Delivery code suppresses local dispatch/stanza acknowledgement. This is not proof that all of the user's outgoing message bubbles permanently stay at one tick. |
| Anti-Revoke | `app/src/main/java/com/waenhancer/xposed/features/privacy/AntiRevokeHook.java` | `e3bc739ec02a33e154ed51692d71f8d711289715` | Hooks host revoke paths, keeps local records and decorates chat rows. It acts against another sender's delete-for-everyone choice; SAMURAI will not port this bypass. |
| Anti-View Once | `app/src/main/java/com/waenhancer/xposed/features/privacy/AntiViewOnceHook.java` | `e01cf5041806b50a651b7cb63c4b03aa40fc05ee` | The source explicitly changes a view-once state flag from 1 to 0. This defeats the sender's one-time viewing control; SAMURAI will not implement this bypass. |
| Freeze own presence | `app/src/main/java/com/waenhancer/xposed/features/privacy/FreezeLastSeenHook.java` | `1b6855f706d074b88d99a721a3bcf5447fd85463` | Suppresses the local account's own availability/presence updates. It does not reveal another contact's hidden last-seen/online state. |
| Always Online | `app/src/main/java/com/waenhancer/xposed/features/privacy/AlwaysOnlineHook.java` | `aaf2e6b94c7457e8a9d51b4a2c120684ad1be0c1` | Alters the local account's own unavailable transition. Not a hidden-presence tracker. |

These conclusions are source review only. They do not establish runtime compatibility or successful behavior on any specific WhatsApp release/device.

## 2. The critical One Tick distinction

The upstream name `Hide Delivered` is easy to misread.

The inspected hook targets receipts emitted by the local WhatsApp account. Suppressing a delivery acknowledgement from this device may cause the other participant not to receive a delivery confirmation for a message they sent to this account.

It does **not** by itself establish the user's requested behavior of sending a message from this account and always seeing one grey check on the sender's own screen after the recipient has received it. That would require a separate, verified sender-side display or protocol behavior and a two-device test.

SAMURAI must therefore model these as separate product requirements:

1. **Hide my outgoing delivery acknowledgements** — local account privacy control.
2. **Hide my outgoing read acknowledgements** — local account privacy control.
3. **Display my sent messages as one tick locally** — presentation control inside SAMURAI-owned UI; not proof of delivery state.
4. **Change how official WhatsApp renders its own outgoing bubble** — not established by the audited upstream hook; requires separate evidence and must not be claimed based on a feature label.

## 3. SAMURAI implementation decision

The independent Xposed lab remains isolated from the ordinary companion APK.

Safe work permitted in the lab:

- Exact package/process/version identification.
- Hook-framework load diagnostics that disclose no chat or personal content.
- Version-pinned compatibility records from an authorized local host APK.
- Test harnesses for locally controlled status/receipt state machines.
- User-controlled suppression of the local account's own presence/receipt notifications only after explicit consent, precise host-method contract validation and two-device test acceptance.

Not included:

- Reading hidden Last Seen, online or read state of another person.
- Defeating View Once or another person's delete-for-everyone choice.
- Scraping private databases or extracting message/media content beyond what the app's owner explicitly selected or Android already exposed as a notification.
- Anti-ban claims or silent installation into the primary WhatsApp package.

## 4. Current SAMURAI Xposed Lab state

The first APK is a diagnostic scaffold, not a feature-complete WhatsApp mod:

- Separate package: `com.samurai.xposed.lab`.
- Xposed metadata and legacy API 82 compile-only dependency.
- Scope limited to `com.whatsapp` and `com.whatsapp.w4b`.
- Main process and exact version tuple gate.
- Non-mutating package/process/version diagnostics.
- Feature hooks hard-disabled.
- JVM unit tests and a separate GitHub Actions workflow.
- Local-only APK DEX/ZIP/metadata audit tooling.

CI success proves that the module builds, its declared Xposed metadata is packaged, and its unit tests pass. It does not prove that LSPosed injected into a device or that any WhatsApp feature works.

## 5. Upstream references

- Repository and README: https://github.com/WaEnhancerX/WaEnhancerX
- Receipt hook: https://github.com/WaEnhancerX/WaEnhancerX/blob/main/app/src/main/java/com/waenhancer/xposed/features/privacy/HideReceiptsHook.java
- Anti-Revoke hook: https://github.com/WaEnhancerX/WaEnhancerX/blob/main/app/src/main/java/com/waenhancer/xposed/features/privacy/AntiRevokeHook.java
- Anti-View Once hook: https://github.com/WaEnhancerX/WaEnhancerX/blob/main/app/src/main/java/com/waenhancer/xposed/features/privacy/AntiViewOnceHook.java
- Freeze Last Seen hook: https://github.com/WaEnhancerX/WaEnhancerX/blob/main/app/src/main/java/com/waenhancer/xposed/features/privacy/FreezeLastSeenHook.java
