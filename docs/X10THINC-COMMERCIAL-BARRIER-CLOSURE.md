# X10THINC Commercial Barrier Closure

## Objective

Turn the CI Recovery Pilot from a feature pitch into a low-risk evidence-driven purchase.

## Barrier map

### 1. "I don't trust AI code changes."

Response: Kill Critic is a separate gate. The system can **BLOCK** or **ABSTAIN**. Human review remains required.

### 2. "I don't want to give production access."

Response: start read-only against a non-production repository. No deployment credentials are required for the discovery audit.

### 3. "Prove it before I pay."

Response: free public-repository health check, followed by a fixed-price Express Audit.

### 4. "I don't understand what I'm buying."

Response: one narrow outcome: **one failing workflow → verified recovery evidence**.

### 5. "A demo is not a real result."

Response: deterministic Recovery Lab + then one real customer repository. Public lab is explicitly labelled as a fixture.

### 6. "What if your repair is wrong?"

Response: sandbox/tests must pass; otherwise the result is not VERIFIED.

### 7. "What if the change is dangerous?"

Response: protected paths and configured rules fail closed. BLOCK includes an exact rule and affected path.

### 8. "Can I audit the decision?"

Response: Proof Receipt binds incident, source revision, proposed change, verdict, verification state and evidence hash.

### 9. "What if the AI is uncertain?"

Response: ABSTAIN is a first-class terminal state. No proof is emitted as VERIFIED without verification evidence.

### 10. "Will this replace my engineers?"

Response: positioning is recovery acceleration and evidence, not engineer replacement.

### 11. "How do I know the result is useful?"

Response: measure TIME_TO_PROOF and compare it with the customer's baseline recovery process.

### 12. "Why should I buy now?"

Response: begin with one bounded failure class and a fixed pilot scope. The customer can stop after the pilot.

## Funnel design

```
PUBLIC REPO
   ↓
FREE HEALTH CHECK
   ↓
EXPRESS AUDIT ($300–500)
   ↓
CI RECOVERY PILOT ($750–1,500)
   ↓
INTEGRATION ($2k–5k+)
   ↓
OPTIONAL RECURRING SERVICE
```

The free step exists to reduce trust/access friction, not to become unlimited consulting.

## Qualification

Prioritize repositories showing:

- active GitHub Actions workflows;
- repeated failures;
- visible engineering activity;
- a technical owner;
- a non-production path for testing;
- an identifiable cost of recovery.

Do not claim a prospect has a problem until the repository evidence supports it.

## Sales proof package

Every serious prospect should receive:

1. one deterministic lab link;
2. one real repository finding when available;
3. one short Proof Receipt example;
4. one fixed pilot scope;
5. one explicit safety boundary;
6. one measurable KPI.

## Commercial discipline

The first goal is not maximum feature count. It is:

**external repository → verified result → paid pilot → customer evidence.**

Until external evidence exists, use the terms **prototype**, **lab**, and **pilot** rather than production-scale claims.
