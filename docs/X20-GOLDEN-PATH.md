# X20 Golden Path
1. Trigger an intentionally failing CI run.
2. Receive workflow_run completed event.
3. Create persistent recovery job.
4. Produce evidence-only diagnosis.
5. Generate minimal patch.
6. Run Kill Critic policy.
7. Execute in isolated sandbox.
8. Run tests.
9. Create recovery branch + commit + Draft PR.
10. Wait for CI workflow_run.
11. Require success AND exact head_sha == recovery.commitSha.
12. Generate proof receipt.
13. Mark recovered.
Negative tests: malicious patch, wrong SHA green CI, timeout, excessive files, restart during queue, duplicate webhook.
