# Capability feasibility audit

Status labels: **Prototype** = implemented in this branch; **Partial** = limited workaround; **Blocked** = cannot be delivered by a companion app through supported Android APIs.

| Requirement | Status | Evidence / limitation |
|---|---|---|
| Custom interface, themes, typography | Prototype foundation | Own app UI; theming can expand independently |
| Local notification archive | Prototype | Requires explicit Notification Access; only notification content Android exposes |
| Anti-Delete | Partial | A notification copy may survive later deletion; no guarantee if preview hidden, notification absent, or content truncated |
| Hide second tick / one tick after delivery | Blocked | Companion app cannot control WhatsApp delivery/read receipts |
| Hide blue read receipts | Blocked | Must be configured within supported WhatsApp settings; no external override |
| Hide online / last seen / typing / recording | Blocked | No supported companion API to change these protocol states |
| Anti-View Once | Blocked | Notification listener does not receive View Once media bytes |
| Save user-accessible media | Future | Explicit import/share flow only |
| Local archive encryption | Prototype | AES-256-GCM; key stored in Android Keystore |
| Disable WhatsApp network independently | Not in V1 | Requires supported OS controls or VPN-based filtering; a VPN would introduce broad network trust and is not justified yet |
| Separate experimental client | Design only | Must not be used with primary account without a separate risk review |

## Key findings

- Android's NotificationListenerService receives posted/removed notification callbacks, not WhatsApp's internal message database or protocol events.
- Notification removal is not proof that a sender deleted a message for everyone.
- WhatsApp states that unofficial altered apps violate its Terms and warns of privacy/security risks; it may temporarily or permanently restrict accounts.
- WhatsApp Business Platform APIs are business messaging APIs, not a replacement API for a personal WhatsApp client and not a route to manipulate personal read receipts.

## Go / no-go

**GO:** continue the independent companion app, notification archive, local privacy controls, and user-imported media vault.

**NO-GO for primary account:** root/LSPosed hooks, repackaged WhatsApp APKs, protocol manipulation, or unverified anti-ban claims.

## Sources

- Android NotificationListenerService: https://developer.android.com/reference/android/service/notification/NotificationListenerService
- WhatsApp warning about unofficial apps: https://faq.whatsapp.com/451658463723880/?cms_platform=android
- WhatsApp temporary bans and unofficial apps: https://faq.whatsapp.com/1848531392146538/?locale=tl_PH
- WhatsApp Business Platform overview: https://developers.facebook.com/documentation/business-messaging/whatsapp/overview
