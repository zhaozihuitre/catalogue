import type { AiSummary, AiSummaryDTO } from '@catalogue/shared';
import { nowIso, type DB } from '../db';

const SELECT = `SELECT attachment_id AS attachmentId, conclusion, era, material, institution,
  risk_notes AS riskNotes, model, created_at AS createdAt FROM ai_summaries`;

export function getSummary(db: DB, attachmentId: string): AiSummaryDTO | null {
  return (db.prepare(`${SELECT} WHERE attachment_id = ?`).get(attachmentId) as AiSummaryDTO | undefined) ?? null;
}

export function listItemSummaries(db: DB, itemId: string): AiSummaryDTO[] {
  return db
    .prepare(`${SELECT} WHERE attachment_id IN (SELECT id FROM attachments WHERE item_id = ?) ORDER BY created_at`)
    .all(itemId) as AiSummaryDTO[];
}

export function saveSummary(db: DB, attachmentId: string, s: AiSummary, model: string): void {
  db.prepare(
    `INSERT INTO ai_summaries (attachment_id, conclusion, era, material, institution, risk_notes, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(attachment_id) DO UPDATE SET conclusion = excluded.conclusion, era = excluded.era,
       material = excluded.material, institution = excluded.institution, risk_notes = excluded.risk_notes,
       model = excluded.model, created_at = excluded.created_at`,
  ).run(attachmentId, s.conclusion, s.era, s.material, s.institution, s.riskNotes, model, nowIso());
}
