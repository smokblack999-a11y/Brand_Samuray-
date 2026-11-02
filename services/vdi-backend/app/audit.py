from datetime import datetime, timedelta, timezone


def reconcile_events(events: list[dict], stale_after_minutes: int = 120, now: datetime | None = None) -> dict:
    """Find operational inconsistencies without making access or payment decisions."""
    now = now or datetime.now(timezone.utc)
    grouped: dict[str, list[dict]] = {}
    for event in events:
        token = event.get("plate_token")
        if token:
            grouped.setdefault(token, []).append(event)

    findings = []
    for rows in grouped.values():
        rows.sort(key=lambda item: item["occurred_at"])
        open_entry = None
        payments = []
        for event in rows:
            kind = event.get("event_type", "plate_observed")
            if kind == "entry":
                if open_entry is not None:
                    findings.append({
                        "type": "DUPLICATE_ENTRY_WITHOUT_EXIT",
                        "severity": "review",
                        "event_id": event["event_id"],
                        "related_event_id": open_entry["event_id"],
                        "plate_masked": event.get("plate_masked"),
                        "occurred_at": event["occurred_at"],
                        "message": "A second entry was recorded before an exit for the previous entry."
                    })
                else:
                    open_entry = event
                    payments = []
            elif kind == "payment" and open_entry is not None:
                payments.append(event)
            elif kind == "exit":
                if open_entry is None:
                    findings.append({
                        "type": "EXIT_WITHOUT_ENTRY",
                        "severity": "review",
                        "event_id": event["event_id"],
                        "related_event_id": None,
                        "plate_masked": event.get("plate_masked"),
                        "occurred_at": event["occurred_at"],
                        "message": "An exit was recorded without a matching earlier entry."
                    })
                else:
                    if not payments:
                        findings.append({
                            "type": "EXIT_WITHOUT_RECORDED_PAYMENT",
                            "severity": "review",
                            "event_id": event["event_id"],
                            "related_event_id": open_entry["event_id"],
                            "plate_masked": event.get("plate_masked"),
                            "occurred_at": event["occurred_at"],
                            "message": "An entry and exit were found, but no payment event was recorded between them."
                        })
                    open_entry = None
                    payments = []

        if open_entry is not None:
            try:
                entered = datetime.fromisoformat(open_entry["occurred_at"].replace("Z", "+00:00"))
                if entered.tzinfo is None:
                    entered = entered.replace(tzinfo=timezone.utc)
                if now - entered >= timedelta(minutes=stale_after_minutes):
                    findings.append({
                        "type": "ENTRY_WITHOUT_EXIT",
                        "severity": "review",
                        "event_id": open_entry["event_id"],
                        "related_event_id": None,
                        "plate_masked": open_entry.get("plate_masked"),
                        "occurred_at": open_entry["occurred_at"],
                        "message": "An entry is older than the configured threshold and no exit has been recorded."
                    })
            except (TypeError, ValueError):
                findings.append({
                    "type": "INVALID_EVENT_TIMESTAMP",
                    "severity": "review",
                    "event_id": open_entry["event_id"],
                    "related_event_id": None,
                    "plate_masked": open_entry.get("plate_masked"),
                    "occurred_at": open_entry.get("occurred_at"),
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
