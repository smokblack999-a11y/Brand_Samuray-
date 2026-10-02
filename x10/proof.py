import hashlib
import json

async def create_receipt(conn, incident_id, run_id, payload):
    previous = await conn.fetchval(
        "SELECT proof_hash FROM x10_proof_receipts WHERE incident_id=$1 ORDER BY created_at DESC LIMIT 1",
        incident_id,
    )
    body = {
        "schema": "samuraios-proof-receipt/v1",
        "incident_id": incident_id,
        "run_id": run_id,
        "payload": payload,
        "previous_hash": previous,
    }
    proof_hash = hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",",":")).encode()
    ).hexdigest()
    proof_id = f"proof_{incident_id}_{proof_hash[:16]}"
    await conn.execute(
        """INSERT INTO x10_proof_receipts
        (proof_receipt_id,incident_id,run_id,payload,previous_hash,proof_hash)
        VALUES($1,$2,$3,$4::jsonb,$5,$6)""",
        proof_id, incident_id, run_id, json.dumps(body), previous, proof_hash,
    )
    return {**body, "proof_receipt_id": proof_id, "proof_hash": proof_hash}
