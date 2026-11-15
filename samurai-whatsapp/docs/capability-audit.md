# Capability feasibility audit

Status labels:
- **Implemented** — code exists in the feature branch.
- **CI-verified** — build and automated tests pass on GitHub Actions.
- **Device pending** — requires a real Samsung test.
- **Partial** — limited workaround, not a full feature.
- **Blocked** — cannot be delivered by a companion app through supported Android APIs.

| Requirement | Current status | Evidence / limitation |
|---|---|---|
| Independent app identity | Implemented | `com.samurai.whatsapp`; does not replace official WhatsApp |
| Custom interface | Implemented foundation | Local control screen, status, archive viewer |
| Explicit notification consent | Implemented | Opens Android Notification Access settings |
| WhatsApp / Business filtering | Implemented | Package allowlist in listener |
| MessagingStyle text extraction | Implemented | AndroidX NotificationCompat MessagingStyle plus standard text fallbacks |
| Local encrypted archive | Implemented; CI pending | AES-256-GCM, Android Keystore key |
| Pause/resume archiving | Implemented | Local switch; listener checks the flag before persistence |
| Clear archive | Implemented | User-confirmed local deletion |
| Retention limit | Implemented; CI pending | Maximum 200 records |
| Anti-Delete | Partial | A notification copy may survive later deletion; no guarantee if preview hidden, notification absent, or content truncated |
| Hide second tick / one tick after delivery | Blocked | Companion app cannot control WhatsApp delivery/read receipts |
| Hide blue read receipts | Blocked | Must be configured within supported WhatsApp settings; no external override |
| Hide online / last seen / typing / recording | Blocked | No supported companion API to change these protocol states |
| Anti-View Once | Blocked | Notification listener does not receive View Once media bytes |
| Save user-accessible media | Future | Explicit import/share flow only |
| Network/backend sync | Intentionally absent | No Internet permission in companion manifest |
| Modified WhatsApp client | Not implemented | Requires separate risk review; not safe to claim anti-ban |

## Verification gates

1. Gradle compiles Kotlin source.
2. APK contains MainActivity, WhatsAppNotificationListener, and NotificationArchive DEX classes.
3. Android emulator tests verify encryption round-trip, no plaintext in preferences, pause behavior, and 200-record cap.
4. Real Samsung Galaxy A54 test verifies notification access, actual WhatsApp preview delivery, archive display, pause, and clear behavior.

Do not mark gate 4 successful based on CI or emulator evidence.

## Key findings

- Android NotificationListenerService receives notification callbacks, not WhatsApp's internal message database or protocol events.
- Notification removal is not proof that a sender deleted a message for everyone.
- WhatsApp states that unofficial altered apps violate its Terms and warns of privacy/security risks; it may temporarily or permanently restrict accounts.
- WhatsApp Business Platform APIs are business messaging APIs, not a replacement API for a personal WhatsApp client and not a route to manipulate personal read receipts.

## Go / no-go

**GO:** continue the independent companion app, notification archive, local privacy controls, and user-imported media vault.

**NO-GO for primary account:** root/LSPosed hooks, repackaged WhatsApp APKs, protocol manipulation, or unverified anti-ban claims.

## Sources

- Android NotificationListenerService: https://developer.android.com/reference/android/service/notification/NotificationListenerService
- AndroidX MessagingStyle: https://developer.android.com/reference/androidx/core/app/NotificationCompat.MessagingStyle
- WhatsApp warning about unofficial apps: https://faq.whatsapp.com/451658463723880/?cms_platform=android
- WhatsApp temporary bans and unofficial apps: https://faq.whatsapp.com/1848531392146538/?locale=tl_PH
- WhatsApp Business Platform overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/overview
