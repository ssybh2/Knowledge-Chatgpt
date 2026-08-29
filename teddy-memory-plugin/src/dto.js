export function toPublicMemory(row) {
  const out = {
    memory_ref: String(row.memory_ref),
    title: String(row.title),
    category: String(row.category),
    summary: String(row.summary),
    revision: Number(row.revision),
  };

  if (row.event_time !== null && row.event_time !== undefined) {
    out.event_time = Number(row.event_time);
  }

  return out;
}
