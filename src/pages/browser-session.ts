import {
  assertBattleEvent,
  BattleStateStore,
  type ActiveSlot,
  type BattleEvent,
  type SideId,
} from '../core/battle-state.js';
import type {
  BattleSessionMetadata,
  BattleSessionSnapshot,
  DecisionRecord,
  PersistedBattleSession,
  SessionResult,
} from '../web/live-types.js';

interface StartSessionInput {
  title?: string;
  formatId?: string;
}

interface FinishSessionInput {
  result?: SessionResult;
  notes?: string;
}

interface RecordDecisionInput {
  evaluationRevision: number;
  side: SideId;
  kind: 'individual' | 'joint';
  actionId: string;
  label: string;
  score: number;
  actorSlots: ActiveSlot[];
  notes?: string;
}

interface StoredSession {
  schemaVersion: 1;
  metadata: BattleSessionMetadata;
  events: BattleEvent[];
  decisions: DecisionRecord[];
}

function now(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${value}`;
}

function createMetadata(input: StartSessionInput = {}): BattleSessionMetadata {
  const timestamp = now();
  return {
    id: randomId('battle'),
    title: input.title?.trim() || 'Pokémon Champions Battle',
    formatId: input.formatId?.trim() || 'gen9championsvgc2026regma',
    status: 'active',
    result: null,
    notes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    finishedAt: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateMetadata(value: unknown): BattleSessionMetadata {
  if (!isRecord(value)) throw new Error('セッションmetadataが不正です。');
  if (value.status !== 'active' && value.status !== 'finished') throw new Error('セッションstatusが不正です。');
  const allowedResults = new Set(['win', 'loss', 'draw', 'cancelled', 'unknown']);
  if (value.result !== null && !allowedResults.has(String(value.result))) throw new Error('セッションresultが不正です。');
  for (const key of ['id', 'title', 'formatId', 'notes', 'createdAt', 'updatedAt'] as const) {
    if (typeof value[key] !== 'string') throw new Error(`metadata.${key}が不正です。`);
  }
  if (value.finishedAt !== null && typeof value.finishedAt !== 'string') throw new Error('metadata.finishedAtが不正です。');
  return {
    id: value.id as string,
    title: value.title as string,
    formatId: value.formatId as string,
    status: value.status,
    result: value.result as SessionResult | null,
    notes: value.notes as string,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
    finishedAt: value.finishedAt as string | null,
  };
}

function validateDecision(value: unknown): DecisionRecord {
  if (!isRecord(value)) throw new Error('decisionが不正です。');
  if (value.side !== 'p1' && value.side !== 'p2') throw new Error('decision.sideが不正です。');
  if (value.kind !== 'individual' && value.kind !== 'joint') throw new Error('decision.kindが不正です。');
  if (!Array.isArray(value.actorSlots) || value.actorSlots.some((slot) => !/^(p1|p2)[ab]$/.test(String(slot)))) {
    throw new Error('decision.actorSlotsが不正です。');
  }
  for (const key of ['id', 'createdAt', 'actionId', 'label', 'notes'] as const) {
    if (typeof value[key] !== 'string') throw new Error(`decision.${key}が不正です。`);
  }
  for (const key of ['evaluationRevision', 'turn', 'score'] as const) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) throw new Error(`decision.${key}が不正です。`);
  }
  return {
    id: value.id as string,
    createdAt: value.createdAt as string,
    evaluationRevision: Math.max(0, Math.trunc(value.evaluationRevision as number)),
    turn: Math.max(0, Math.trunc(value.turn as number)),
    side: value.side,
    kind: value.kind,
    actionId: value.actionId as string,
    label: value.label as string,
    score: value.score as number,
    actorSlots: value.actorSlots as ActiveSlot[],
    notes: value.notes as string,
  };
}

function validateStoredSession(value: unknown): StoredSession {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error('未対応のセッションファイルです。');
  if (!Array.isArray(value.events)) throw new Error('セッションeventsが不正です。');
  const events = value.events.map((event) => {
    assertBattleEvent(event);
    return structuredClone(event);
  });
  const decisions = Array.isArray(value.decisions) ? value.decisions.map(validateDecision) : [];
  return {
    schemaVersion: 1,
    metadata: validateMetadata(value.metadata),
    events,
    decisions,
  };
}

export class BrowserBattleSession {
  private store = new BattleStateStore();
  private metadata = createMetadata();
  private events: BattleEvent[] = [];
  private decisions: DecisionRecord[] = [];

  constructor(private readonly storageKey: string) {}

  initialize(): BattleSessionSnapshot {
    const text = localStorage.getItem(this.storageKey);
    if (text) {
      try {
        this.restore(validateStoredSession(JSON.parse(text) as unknown));
        return this.snapshot();
      } catch {
        localStorage.removeItem(this.storageKey);
      }
    }
    this.persist();
    return this.snapshot();
  }

  snapshot(): BattleSessionSnapshot {
    return {
      metadata: structuredClone(this.metadata),
      state: this.store.snapshot(),
      decisions: structuredClone(this.decisions),
      eventCount: this.events.length,
    };
  }

  stateSnapshot() {
    return this.store.snapshot();
  }

  exportData(): PersistedBattleSession {
    return {
      schemaVersion: 1,
      metadata: structuredClone(this.metadata),
      events: structuredClone(this.events) as unknown as Record<string, unknown>[],
      decisions: structuredClone(this.decisions),
    };
  }

  startNew(input: StartSessionInput = {}): BattleSessionSnapshot {
    this.store = new BattleStateStore();
    this.metadata = createMetadata(input);
    this.events = [];
    this.decisions = [];
    this.persist();
    return this.snapshot();
  }

  resetState(): BattleSessionSnapshot {
    return this.startNew({ title: this.metadata.title, formatId: this.metadata.formatId });
  }

  applyMany(events: readonly BattleEvent[]): BattleSessionSnapshot {
    if (this.metadata.status === 'finished') throw new Error('終了済みの対戦です。新しい対戦を開始してください。');
    const cloned = events.map((event) => {
      assertBattleEvent(event);
      return structuredClone(event);
    });
    this.store.applyMany(cloned);
    this.events.push(...cloned);
    this.metadata.updatedAt = now();
    this.persist();
    return this.snapshot();
  }

  undo(count = 1): BattleSessionSnapshot {
    const normalized = Math.max(1, Math.min(100, Math.trunc(count)));
    this.events.splice(Math.max(0, this.events.length - normalized), normalized);
    this.replay();
    const revision = this.store.snapshot().revision;
    this.decisions = this.decisions.filter((decision) => decision.evaluationRevision <= revision);
    this.metadata.status = 'active';
    this.metadata.result = null;
    this.metadata.finishedAt = null;
    this.metadata.updatedAt = now();
    this.persist();
    return this.snapshot();
  }

  importData(value: unknown): BattleSessionSnapshot {
    this.restore(validateStoredSession(value));
    this.metadata.updatedAt = now();
    this.persist();
    return this.snapshot();
  }

  recordDecision(input: RecordDecisionInput): BattleSessionSnapshot {
    const state = this.store.snapshot();
    if (input.evaluationRevision !== state.revision) {
      throw new Error('評価後に盤面が変化しています。再評価してから採用してください。');
    }
    if (!input.actionId.trim() || !input.label.trim()) throw new Error('採用する行動が不正です。');
    if (!Number.isFinite(input.score)) throw new Error('行動スコアが不正です。');
    this.decisions.push({
      id: randomId('decision'),
      createdAt: now(),
      evaluationRevision: state.revision,
      turn: state.turn,
      side: input.side,
      kind: input.kind,
      actionId: input.actionId.trim(),
      label: input.label.trim(),
      score: input.score,
      actorSlots: [...input.actorSlots],
      notes: input.notes?.trim() || '',
    });
    if (this.decisions.length > 500) this.decisions.splice(0, this.decisions.length - 500);
    this.metadata.updatedAt = now();
    this.persist();
    return this.snapshot();
  }

  finish(input: FinishSessionInput = {}): BattleSessionSnapshot {
    const timestamp = now();
    this.metadata.status = 'finished';
    this.metadata.result = input.result ?? 'unknown';
    this.metadata.notes = input.notes?.trim() ?? this.metadata.notes;
    this.metadata.updatedAt = timestamp;
    this.metadata.finishedAt = timestamp;
    this.persist();
    return this.snapshot();
  }

  private restore(saved: StoredSession): void {
    this.metadata = structuredClone(saved.metadata);
    this.events = structuredClone(saved.events);
    this.decisions = structuredClone(saved.decisions);
    this.replay();
  }

  private replay(): void {
    this.store = new BattleStateStore();
    this.store.applyMany(this.events);
  }

  private persist(): void {
    const data: StoredSession = {
      schemaVersion: 1,
      metadata: this.metadata,
      events: this.events,
      decisions: this.decisions,
    };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      throw new Error('ブラウザー保存領域へ書き込めませんでした。JSONで保存してください。');
    }
  }
}
