# SAMURAI Business Automation — paid pilot offer (commercial hypothesis)

Status: proposal only. This is not a claim that the complete product is production-ready.

## Target customer
A small online seller or local delivery operator in Kazakhstan that receives orders through Telegram/WhatsApp/social channels and coordinates administrators and couriers manually.

## Pilot outcome
Run one real, bounded order workflow with an auditable status trail:
1. Customer/order intake.
2. Admin review and assignment.
3. Manual payment confirmation (no card charging in SAMURAI).
4. Courier task handoff.
5. Delivery photo/proof submission.
6. Customer status notification.
7. Basic daily operations report.

## Proposed pilot scope
- One legal business/customer.
- One Telegram workflow and one admin workspace.
- Up to 10 staff accounts/roles, subject to security validation.
- One delivery process and one operating location.
- Manual payment verification only.
- Pilot data retention and export agreed with the customer.
- Weekly review of failures, completion rate, and operator time.

## Proposed commercial terms — validate through sales interviews
- Paid design-partner pilot: KZT 600,000–1,200,000 for 4–6 weeks.
- After acceptance: KZT 99,000–199,000 per month for a limited standard package.
- Customer-specific integrations, migration, or custom workflows are separately scoped.
- Do not promise payment processing, tax/accounting, marketplace integrations, guaranteed AI accuracy, or 24/7 SLA unless separately implemented and tested.

These prices are initial hypotheses, not verified market-clearing prices. Adjust after 10–15 buyer interviews and at least 3 written proposals.

## Acceptance criteria
A pilot is accepted only when all agreed scenarios pass in the customer's environment:
- An order can be created and uniquely identified.
- An administrator can review and assign it.
- Payment status can be manually recorded with actor and timestamp.
- The courier can receive the task and submit delivery proof.
- The customer receives the correct status update.
- Failed operations are visible and recoverable.
- Access is role-limited; secrets are not exposed to clients.
- Customer data can be exported and deleted under the agreed policy.

Record scenario count, successful completion rate, median order handling time, support incidents, and customer willingness to continue paying.

## Delivery plan
- Week 1: process mapping, data boundaries, customer acceptance criteria.
- Week 2: tenant setup, roles, order lifecycle, test data.
- Weeks 3–4: admin/courier workflow, notifications, failure handling.
- Weeks 5–6: supervised live pilot, fixes, measurement, handover.

Timeline is a planning estimate; it starts only after customer access, process decisions, and scope are confirmed.

## Commercial validation gates
1. 10–15 interviews with target businesses.
2. At least 3 written offers sent.
3. At least 1 paid pilot signed before expanding scope.
4. Convert only if the customer uses the workflow repeatedly and agrees to a recurring fee.

## Revenue scenarios (gross recurring revenue, not profit)
At KZT 99,000/month:
- 5 customers: KZT 495,000 MRR / KZT 5.94m ARR.
- 10 customers: KZT 990,000 MRR / KZT 11.88m ARR.
- 25 customers: KZT 2.475m MRR / KZT 29.7m ARR.

At KZT 199,000/month:
- 5 customers: KZT 995,000 MRR / KZT 11.94m ARR.
- 10 customers: KZT 1.99m MRR / KZT 23.88m ARR.
- 25 customers: KZT 4.975m MRR / KZT 59.7m ARR.

ARR is annualized recurring revenue at the stated customer count; it is not a forecast, cash collected, valuation, or net income. Excludes setup fees, taxes, churn, discounts, AI/hosting costs, support, sales, and development.

## Go/no-go decision
Proceed beyond the first pilot only if:
- the customer completes real orders through the workflow;
- the system meets agreed reliability and recovery criteria;
- support effort is economically sustainable;
- at least one customer pays the recurring fee after pilot;
- no unresolved critical security issue remains.

## Current known limitations
- SAMURAI Commerce HTTP V1 is a test-mode integration, not a live payment processor.
- The delivery bot's full Telegram end-to-end flow has not yet been independently confirmed.
- Software Factory X10 is a draft isolated MVP; its real Docker integration CI is still being validated.
- No production SLA, multi-tenant isolation certification, or independent security audit is claimed.
