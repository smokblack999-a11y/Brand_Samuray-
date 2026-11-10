# SAMURAI Revenue Recovery — Kazakhstan Sales Validation Kit

Status: controlled commercial experiment. No customer demand, paid pilot, recovered revenue, or MRR has been validated.

## Primary offer to test

**SAMURAI Lead Response Audit — 49,000 ₸ (price hypothesis)**

- One pseudonymized CSV export, up to 10,000 rows.
- Required fields only: `lead_id`, `created_at`, `first_response_at`, `outcome`.
- Measures recorded first-response times against the client's agreed SLA.
- Separates within-SLA, late-response, and no-recorded-response cohorts.
- Compares outcomes by response group, excluding open deals from closed-deal win-rate denominators.
- Provides a data-quality note and operational recommendations.
- No CRM write access, no messages, no automated follow-up, and no claim that every late or missing response caused lost revenue.

This is a diagnostic service, not a guarantee of recovered sales.

## Primary ICP — Kazakhstan home services

Start with HVAC / climate installation, repair and maintenance companies in Almaty and Astana.

Qualification hypotheses (must be confirmed in discovery):
1. Approximately 30+ inbound inquiries per month.
2. More than one field team or technician.
3. Handles installation, repair and/or recurring maintenance.
4. Receives inquiries through WhatsApp, Instagram, website and/or phone.
5. Has a named owner, director or sales/operations manager.
6. Can export pseudonymized lead records with creation time, first response time and outcome.
7. Is willing to pay for a diagnostic if the scope and data handling are clear.

Secondary segments: plumbing/heating services and electrical/engineering contractors. Do not mix all segments in the first cohort without tracking them separately.

Disqualify if the company has very low inquiry volume, no usable timestamps, cannot approve data processing, expects guaranteed revenue, or requires automatic outbound messaging for the first engagement.

## Delivery procedure

1. Confirm scope, lawful basis/permission, data owner, retention period and deletion procedure in writing.
2. Ask the client to export only the four required columns. Replace customer identifiers with random or pseudonymous IDs before transfer.
3. Reject files with additional columns. Do not request names, phone numbers, email addresses, message text, addresses or payment details.
4. Validate timestamps, time zones, outcomes, duplicate IDs and row counts.
5. Run the audit and record the exact input file hash, version, run time and operator.
6. Review missing timestamps with the client. A missing timestamp can mean missing logging, not proof that no contact occurred.
7. Deliver the aggregate report, limitations and a short list of process changes.
8. Delete the input file according to the agreed retention schedule and record deletion.

## Follow-on offer

Only after a paid audit identifies a measurable process gap, test a bounded 14-day human-operated follow-up improvement pilot.

Possible subscription hypothesis after evidence:
- 39,900–59,900 ₸ per month for recurring data-quality and response-gap reports, overdue follow-up visibility and recovery tracking.
- CRM integration, WhatsApp Business Platform integration, custom workflows and automated messaging are separate scope and pricing.
- Automatic sending stays disabled until the client approves the exact policy and separate integration/security tests pass.

Prices are experiments, not market averages or validated willingness-to-pay.

## Manual outbound sequence — draft only

No outreach is authorized or sent by this document.

- Day 0: research the company and identify a relevant public business contact.
- Day 2–3: send one individually reviewed business email or use another permitted business channel.
- Day 5–6: one appropriate follow-up by business phone, if permitted.
- Day 9–10: share a synthetic example report.
- Day 14–15: close the loop politely and stop unless the recipient asks to continue.

Respect channel preferences, applicable Kazakhstan privacy/marketing requirements and opt-outs. Do not scrape personal contact data, mass-message WhatsApp users or automate sending from this MVP.

### Initial message — Russian draft

Тема: Как вы контролируете скорость ответа на заявки?

Здравствуйте!

Изучаю, как HVAC-компании контролируют входящие заявки после обращения клиента. Мы тестируем узкий аудит: по обезличенному экспорту CRM он показывает время первого ответа, заявки без зафиксированного ответа и различия в исходах по группам.

Мы не просим доступ к CRM, не отправляем сообщения и не утверждаем, что каждая задержка означает потерянную продажу.

Подскажите, кто у вас отвечает за контроль заявок после первого обращения и отправки сметы? Если тема актуальна, могу показать короткий синтетический пример отчёта.

Если это не относится к вашим задачам, больше писать не буду.

SAMURAI Revenue Recovery

## Discovery questions

1. How many new inquiries arrive in a typical month?
2. Which channels generate them?
3. Where are inquiries recorded today?
4. Are creation time, first response time and outcome stored for the same lead?
5. What response SLA does the team use?
6. How many technicians or field teams handle jobs?
7. What happens after an estimate/quote is sent?
8. Who owns overdue follow-up?
9. Can the company provide a redacted export with only the four required fields?
10. What evidence would make a paid audit worth 49,000 ₸?

Do not collect customer-level personal data during initial qualification.

## Pilot tracking

Track one row per company:
- prospect_id (internal pseudonymous ID)
- company, city, vertical
- website / public business source
- qualification_reason
- public business contact source
- CRM and export availability (yes/no/unknown)
- inquiry_volume_band
- decision_maker_role
- contacted_date / channel / reply_type
- discovery_call
- redacted_sample_available
- paid_audit_offered / accepted / paid
- delivery_hours / direct_cost_kzt
- result_delivered
- renewal_or_next_step
- opt_out

## Decision gates

Planning thresholds, not industry benchmarks:
- 10 discovery conversations: verify the problem and data availability.
- 20 qualified companies: inspect message relevance and objections.
- 50 qualified companies: target at least 5 meaningful replies and 2 data-availability conversations.
- 100 qualified companies: target at least 10 meaningful replies, 3 sample-data discussions and 1 paid audit.
- 2 paid pilots with measurable client value: continue product development.
- 2 renewals: consider a repeatable MRR offer.

If there is interest but no usable data, redesign the audit. If data exists but findings are inaccurate, improve the algorithm. If the problem exists but nobody will pay, do not add more features to compensate.

## Cash controls

- MVP spending cap: $3,000.
- Initial validation spend target: no more than $1,700; retain the balance.
- Do not buy annual tools, paid ads, complex WhatsApp integrations or production infrastructure before a buyer commits.
- Record actual spend, cash collected, refunds, payment fees, direct delivery costs and founder hours.
- Do not count pipeline, verbal interest or unpaid invoices as revenue.

## Evidence required before scaling

1. A qualified buyer agrees to the written scope.
2. A signed or written acceptance of the paid audit/pilot.
3. Cash is actually received.
4. Redacted client data is processed and a report delivered.
5. Client feedback and a documented next-step decision.
6. Actual delivery hours, costs, repeat purchase and renewal are tracked.

A passing CI run proves code checks passed; it does not prove demand, customer outcomes or business viability.
