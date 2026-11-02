from datetime import datetime, timedelta, timezone
from .tariff import calculate_base_charge


def _parse_time(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timezone missing")
    return parsed.astimezone(timezone.utc)


def reconcile_events(events: list[dict], stale_after_minutes: int = 120, now: datetime | None = None, tariffs: dict | None = None) -> dict:
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
    financial_findings = []
    financial = {"sessions_evaluated": 0, "sessions_without_tariff": 0, "sessions_with_incomplete_payment_data": 0, "by_currency": {}}
    tariffs = tariffs or {}
    for key, rows in grouped.items():
        def sort_key(item):
            try:
                return _parse_time(item["occurred_at"])
            except (TypeError, ValueError):
                return datetime.min.replace(tzinfo=timezone.utc)

        rows.sort(key=sort_key)
        # Keep transaction history, not only its last state: a payment after exit
        # cannot satisfy that exit, and a later refund must reverse an earlier success.
        transaction_history: dict[str, list[tuple[datetime, str | None, int | None, str | None]]] = {}
        for event in rows:
            if event.get("event_type") != "payment":
                continue
            try:
                when = _parse_time(event["occurred_at"])
            except (TypeError, ValueError, KeyError):
                continue
            transaction_key = event.get("transaction_id") or event.get("provider_event_id") or event["event_id"]
            transaction_history.setdefault(transaction_key, []).append((when, event.get("payment_status"), event.get("amount_minor"), event.get("currency")))
        for history in transaction_history.values():
            history.sort(key=lambda item: item[0])

        def has_valid_payment_at(exit_time: datetime) -> bool:
            for history in transaction_history.values():
                states_at_exit = [item for item in history if item[0] <= exit_time]
                if not states_at_exit or states_at_exit[-1][1] != "succeeded":
                    continue
                later_states = [item[1] for item in history if item[0] > exit_time]
                if not any(status in ("refunded", "voided", "failed") for status in later_states):
                    return True
            return False

        def paid_amount_at(exit_time: datetime, currency: str) -> tuple[int, bool]:
            total = 0
            incomplete = False
            for history in transaction_history.values():
                states_at_exit = [item for item in history if item[0] <= exit_time]
                if not states_at_exit:
                    continue
                latest = states_at_exit[-1]
                later_states = [item[1] for item in history if item[0] > exit_time]
                if latest[1] != "succeeded" or any(status in ("refunded", "voided", "failed") for status in later_states):
                    continue
                _, _, amount, payment_currency = latest
                if amount is None or payment_currency != currency:
                    incomplete = True
                    continue
                total += int(amount)
            return total, incomplete
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
                        exit_time = None
                        paid = False
                    if not paid:
                        findings.append({
                            "type": "EXIT_WITHOUT_RECORDED_SUCCESSFUL_PAYMENT", "severity": "review",
                            "event_id": event["event_id"], "related_event_id": open_entry["event_id"],
                            "plate_masked": event.get("plate_masked"), "occurred_at": event["occurred_at"],
                            "message": "No transaction currently has a successful, non-reversed payment state. This does not establish unpaid debt or financial loss."
                        })
                    # Financial comparison is enabled only when the entry references
                    # an operator-configured, immutable tariff rule.
                    tariff_id = open_entry.get("tariff_id")
                    rule = tariffs.get(tariff_id) if tariff_id else None
                    if rule and exit_time is not None:
                        financial["sessions_evaluated"] += 1
                        bucket = financial["by_currency"].setdefault(rule["currency"], {
                            "expected_total_minor": 0, "recorded_paid_total_minor": 0,
                            "under_base_tariff": 0, "exact_base_tariff": 0, "over_base_tariff": 0
                        })
                        try:
                            expected = calculate_base_charge(open_entry["occurred_at"], event["occurred_at"], rule)
                            recorded, incomplete = paid_amount_at(exit_time, rule["currency"])
                            bucket["expected_total_minor"] += expected["base_charge_minor"]
                            bucket["recorded_paid_total_minor"] += recorded
                            if incomplete:
                                financial["sessions_with_incomplete_payment_data"] += 1
                            elif recorded < expected["base_charge_minor"]:
                                bucket["under_base_tariff"] += 1
                                financial_findings.append({
                                    "type": "RECORDED_PAYMENT_BELOW_CONFIGURED_BASE_TARIFF",
                                    "severity": "review", "entry_event_id": open_entry["event_id"],
                                    "exit_event_id": event["event_id"], "tariff_id": tariff_id,
                                    "expected_minor": expected["base_charge_minor"],
                                    "recorded_paid_minor": recorded, "currency": rule["currency"],
                                    "message": "Recorded successful payments are below the configured base tariff. Discounts, validations, subscriptions and external adjustments are not modeled."
                                })
                            elif recorded == expected["base_charge_minor"]:
                                bucket["exact_base_tariff"] += 1
                            else:
                                bucket["over_base_tariff"] += 1
                        except (KeyError, TypeError, ValueError):
                            financial["sessions_with_incomplete_payment_data"] += 1
                    else:
                        financial["sessions_without_tariff"] += 1
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
        "findings": findings,
        "financial_reconciliation": {
            **financial,
            "interpretation": "Configured base-tariff comparison only; not proof of debt or loss. Discounts, subscriptions, validations, tax and provider settlement are not modeled."
        },
        "financial_findings": financial_findings
    }
