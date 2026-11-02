from datetime import datetime, timedelta, timezone


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone missing")
    return parsed.astimezone(timezone.utc)


def reconcile_events(events: list[dict], stale_after_minutes: int = 120, now: datetime | None = None) -> dict:
    """Read-only reconciliation. Findings are review leads, never proof of loss."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    grouped: dict[str, list[dict]] = {}
    for event in events:
        key = ("session:" + event["session_id"]) if event.get("session_id") else (
            "plate:" + event["plate_token"] if event.get("plate_token") else None
        )
        if key:
            grouped.setdefault(key, []).append(event)

    findings = []
    for key, rows in grouped.items():
        def sort_key(item):
            try:
                return _parse_time(item["occurred_at"])
            except (TypeError, ValueError):
                return datetime.min.replace(tzinfo=timezone.utc)

        rows.sort(key=sort_key)
        # Keep transaction history, not only its last state: a payment after exit
        # cannot satisfy that exit, and a later refund must reverse an earlier success.
        transaction_history: dict[str, list[tuple[datetime, str | None]]] = {}
        for event in rows:
            if event.get("event_type") != "payment":
                continue
            try:
                when = _parse_time(event["occurred_at"])
            except (TypeError, ValueError, KeyError):
                continue
            transaction_key = event.get("transaction_id") or event.get("provider_event_id") or event["event_id"]
            transaction_history.setdefault(transaction_key, []).append((when, event.get("payment_status")))
        for history in transaction_history.values():
            history.sort(key=lambda item: item[0])

        def has_valid_payment_at(exit_time: datetime) -> bool:
            for history in transaction_history.values():
                states_at_exit = [status for when, status in history if when <= exit_time]
                if not states_at_exit or states_at_exit[-1] != "succeeded":
                    continue
                later_states = [status for when, status in history if when > exit_time]
                if not any(status in ("refunded", "voided", "failed") for status in later_states):
                    return True
            return False
        open_entry = None
        for event in rows:
            kind = event.get("event_type", "plate_observed")
            if kind == "entry":
                if open_entry is not None:
                    findings.append({
                        "type": "DUPLICATE_ENTRY_WITHOUT_EXIT", "severity": "review",
                        "event_id": event["event_id"], "related_event_id": open_entry["event_id"],
                        "plate_masked": event.get("plate_masked"), "occurred_at": event["occurred_at"],
                        "message": "A second entry was recorded before an exit for the previous session."
                    })
                else:
                    open_entry = event
            elif kind == "exit":
                if open_entry is None:
                    findings.append({
                        "type": "EXIT_WITHOUT_ENTRY", "severity": "review",
                        "event_id": event["event_id"], "related_event_id": None,
                        "plate_masked": event.get("plate_masked"), "occurred_at": event["occurred_at"],
                        "message": "An exit was recorded without a matching earlier entry in the same correlation group."
                    })
                else:
                    try:
                        exit_time = _parse_time(event["occurred_at"])
                        paid = has_valid_payment_at(exit_time)
                    except (TypeError, ValueError, KeyError):
                        paid = False
                    if not paid:
                        findings.append({
                            "type": "EXIT_WITHOUT_RECORDED_SUCCESSFUL_PAYMENT", "severity": "review",
                            "event_id": event["event_id"], "related_event_id": open_entry["event_id"],
                            "plate_masked": event.get("plate_masked"), "occurred_at": event["occurred_at"],
                            "message": "No transaction currently has a successful, non-reversed payment state. This does not establish unpaid debt or financial loss."
                        })
                    open_entry = None

        if open_entry is not None:
            try:
                entered = _parse_time(open_entry["occurred_at"])
                if now - entered >= timedelta(minutes=stale_after_minutes):
                    findings.append({
                        "type": "ENTRY_WITHOUT_EXIT", "severity": "review",
                        "event_id": open_entry["event_id"], "related_event_id": None,
                        "plate_masked": open_entry.get("plate_masked"), "occurred_at": open_entry["occurred_at"],
                        "message": "An entry is older than the configured threshold and no exit has been recorded."
                    })
            except (TypeError, ValueError, KeyError):
                findings.append({
                    "type": "INVALID_EVENT_TIMESTAMP", "severity": "review",
                    "event_id": open_entry["event_id"], "related_event_id": None,
                    "plate_masked": open_entry.get("plate_masked"), "occurred_at": open_entry.get("occurred_at"),
                    "message": "The event timestamp could not be evaluated."
                })

    counts = {}
    for finding in findings:
        counts[finding["type"]] = counts.get(finding["type"], 0) + 1
    return {
        "mode": "read_only_audit",
        "events_examined": len(events),
        "findings_total": len(findings),
        "findings_by_type": counts,
        "findings": findings
    }
