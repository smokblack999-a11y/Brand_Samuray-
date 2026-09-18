function summarizeIncidents(incidents = []) {
  const total = incidents.length;
  const verified = incidents.filter(x => x.status === 'verified').length;
  const rejected = incidents.filter(x => x.status === 'rejected').length;
  const escalated = incidents.filter(x => x.status === 'human_review').length;
  const repaired = incidents.filter(x => x.outcome === 'repaired').length;
  return {
    total,
    verified,
    rejected,
    escalated,
    repaired,
    verifiedRate: total ? Number((verified / total).toFixed(4)) : 0,
    repairRate: total ? Number((repaired / total).toFixed(4)) : 0,
    humanEscalationRate: total ? Number((escalated / total).toFixed(4)) : 0
  };
}

module.exports = { summarizeIncidents };
