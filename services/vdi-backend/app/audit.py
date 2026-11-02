from datetime import datetime, timedelta, timezone


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone missing")
    return parsed.astimezone(timezone.utc)


def reconcile_events(events: list[dict], stale_after_minutes: int = 120, now: datetime | None = None) -> dict:
    """Read-only operational reconciliation. Findings are leads for human review, not proof of loss."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    grouped: dict[str, list[dict]] = {}
    for event in events:
        # Prefer the parking system's stable session ID. Plate token is only a fallback.
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
        open_entry = None
        successful_payments = []
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
                    successful_payments = []
            elif kind == "payment" and open_entry is not None:
                # Pending, failed, voided and refunded transactions are not settled payments.
                if event.get("payment_status") == "succeeded":
                    successful_payments.append(event)
            elif kind == "exit":
                if open_entry is None:
                    findings.append({
                        "type": "EXIT_WITHOUT_ENTRY", "severity": "review",
                        "event_id": event["event_id"], "related_event_id": None,
                        "plate_masked": event.get("plate_masked"), "occurred_at": event["occurred_at"],
                        "message": "An exit was recorded without a matching earlier entry in the same correlation group."
                    })
                else:
                    if not successful_payments:
                        findings.append({
                            "type": "EXIT_WITHOUT_RECORDED_SUCCESSFUL_PAYMENT", "severity": "review",
                            "event_id": event["event_id"], "related_event_id": open_entry["event_id"],
                            "plate_masked": event.get("plate_masked"), "occurred_at": event["occurred_at"],
                            "message": "No successful payment event was received for this session. This does not establish unpaid debt or financial loss."
                        })
                    open_entry = None
                    successful_payments = []

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
            except (TypeError, ValueError):
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
