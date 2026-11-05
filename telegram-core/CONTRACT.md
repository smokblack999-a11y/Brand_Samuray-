# Telegram Core contract v1

This document defines the host-facing boundary. It does not claim that transport methods are implemented yet.

## Required operations

| Operation | Expected behavior |
|---|---|
| `initialize(config)` | Start one isolated TDLib client and report current authorization state |
| `submitPhoneNumber(phone)` | Start login; return the next authorization challenge |
| `submitCode(code)` | Submit the login code |
| `submitPassword(password)` | Handle cloud-password/2FA challenge when requested |
| `getChats(limit, cursor)` | Return paged dialogs, preserving server ordering |
| `getHistory(chatId, limit, fromMessageId)` | Return a stable page of messages |
| `sendText(chatId, text, replyTo?)` | Return a local/server message identity and observable send state |
| `sendPhoto(chatId, file, caption?)` | Upload and send a photo with progress and final result |
| `sendVideo(chatId, file, caption?)` | Upload and send a video with progress and final result |
| `sendFiles(chatId, files, caption?)` | Send supported media as a grouped album where Telegram permits it |
| `downloadFile(fileId)` | Report progress and return an app-owned file handle |
| `observeEvents()` | Stream authorization, connection, chat, message, transfer and error events |
| `logout(deleteLocalSession)` | Close client and optionally remove local account data |

## Domain rules

- IDs are Telegram IDs represented without lossy numeric conversion at language boundaries.
- Every asynchronous action must expose success/failure; no silent swallowing.
- Network disconnection is distinct from authorization failure.
- Retry only operations safe to retry; message sends must avoid blind duplicate sends.
- Media URIs must be resolved by the host and copied/streamed into a controlled private cache where required.
- The module must not assume Google Play Services, a specific device vendor, or a specific host application.
- Multiple accounts require one isolated client/database per account; do not share session databases.

## Authorization state machine

```text
UNINITIALIZED -> WAIT_PHONE -> WAIT_CODE
                           -> WAIT_PASSWORD (when required)
                           -> AUTHORIZED
AUTHORIZED <-> CONNECTING / WAITING_FOR_NETWORK
any state -> LOGGING_OUT -> UNINITIALIZED
```

TDLib remains authoritative for the exact challenge sequence. The host must render the challenge it reports rather than assuming every login follows the same path.

## API compatibility

Public host-facing types must be independent of TDLib classes. TDLib objects are mapped inside the adapter. Breaking changes require a contract version change and migration notes.