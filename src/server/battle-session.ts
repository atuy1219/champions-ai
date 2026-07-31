import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  assertBattleEvent,
  BattleStateStore,
  type ActiveSlot,
  type BattleEvent,
  type BattleState,
  type SideId,
} from '../core/battle-state.js';
import { InputError } from '../core/errors.js';

export type SessionResult = 'win' | 'loss' | 'draw' | 'cancelled' | 'unknown';
export type SessionStatus = 'active' | 'finished';

export interface BattleSessionMetadata {
  id: string;
  title: string;
  formatId: string;
  status: SessionStatus;
  result: SessionResult | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface DecisionRecord {
  id: string;
  createdAt: string;
  evaluationRevision: number;
  turn: number;
  side: SideId;
  kind: 'individual' | 'joint';
  actionId: string;
  label: string;
  score: number;
  actorSlots: ActiveSlot[];
  notes: string;
}

export interface PersistedBattleSession {
  schemaVersion: 1;
  metadata: BattleSessionMetadata;
  events: BattleEvent[];
  decisions: DecisionRecord[];
}

export interface BattleSessionSnapshot {
  metadata: BattleSessionMetadata;
  state: BattleState;
  decisions: DecisionRecord[];
  eventCount: number;
}

export interface StartSessionInput {
  title?: string;
  formatId?: string;
}

export interface FinishSessionInput {
  result?: SessionResult;
  notes?: string;
}

export interface RecordDecisionInput {
  evaluationRevision: number;
  side: SideId;
  kind: 'individual' | 'joint';
  actionId: string;
  label: string;
  score: number;
  actorSlots: ActiveSlot[];
  notes?: string;
}

function now(): string {
  return new Date().toISOString();
}

function sessionId(): string {
  return `battle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createMetadata(input: StartSessionInput = {}): BattleSessionMetadata {
  const timestamp = now();
  return {
    id: sessionId(),
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
  if (!isRecord(value)) throw new InputError('セッションmetadataが不正です。');
  const status = value.status;
  const result = value.result;
  if (status !== 'active' && status !== 'finished') throw new InputError('セッションstatusが不正です。');
  if (result !== null && !['win', 'loss', 'draw', 'cancelled', 'unknown'].includes(String(result))) {
    throw new InputError('セッションresultが不正です。');
  }
  const required = ['id', 'title', 'formatId', 'notes', 'createdAt', 'updatedAt'] as const;
  for (const key of required) {
    if (typeof value[key] !== 'string') throw new InputError(`metadata.${key}が不正です。`);
  }
  if (value.finishedAt !== null && typeof value.finishedAt !== 'string') {
    throw new InputError('metadata.finishedAtが不正です。');
  }
  return {
    id: value.id as string,
    title: value.title as string,
    formatId: value.formatId as string,
    status,
    result: result as SessionResult | null,
    notes: value.notes as string,
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
    finishedAt: value.finishedAt as string | null,
  };
}

function validateEvents(value: unknown): BattleEvent[] {
  if (!Array.isArray(value)) throw new InputError('セッションeventsが配列ではありません。');
  for (const event of value) {
    try {
      assertBattleEvent(event);
    } catch (error) {
      throw new InputError(error instanceof Error ? error.message : 'セッションイベントが不正です。');
    }
  }
  return structuredClone(value) as BattleEvent[];
}

function validateDecision(value: unknown): DecisionRecord {
  if (!isRecord(value)) throw new InputError('decisionが不正です。');
  if (value.side !== 'p1' && value.side !== 'p2') throw new InputError('decision.sideが不正です。');
  if (value.kind !== 'individual' && value.kind !== 'joint') throw new InputError('decision.kindが不正です。');
  if (!Array.isArray(value.actorSlots) || value.actorSlots.some((slot) => !/^(p1|p2)[ab]$/.test(String(slot)))) {
    throw new InputError('decision.actorSlotsが不正です。');
  }
  for (const key of ['id', 'createdAt', 'actionId', 'label', 'notes'] as const) {
    if (typeof value[key] !== 'string') throw new InputError(`decision.${key}が不正です。`);
  }
  if (typeof value.evaluationRevision !== 'number' || !Number.isFinite(value.evaluationRevision)) {
    throw new InputError('decision.evaluationRevisionが不正です。');
  }
  if (typeof value.turn !== 'number' || !Number.isFinite(value.turn)) throw new InputError('decision.turnが不正です。');
  if (typeof value.score !== 'number' || !Number.isFinite(value.score)) throw new InputError('decision.scoreが不正です。');
  return {
    id: value.id as string,
    createdAt: value.createdAt as string,
    evaluationRevision: Math.max(0, Math.trunc(value.evaluationRevision)),
    turn: Math.max(0, Math.trunc(value.turn)),
    side: value.side,
    kind: value.kind,
    actionId: value.actionId as string,
    label: value.label as string,
    score: value.score,
    actorSlots: value.actorSlots as ActiveSlot[],
    notes: value.notes as string,
  };
}

export function validatePersistedSession(value: unknown): PersistedBattleSession {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new InputError('未対応のセッションファイルです。');
  }
  return {
    schemaVersion: 1,
    metadata: validateMetadata(value.metadata),
    events: validateEvents(value.events),
    decisions: Array.isArray(value.decisions) ? value.decisions.map(validateDecision) : [],
  };
}

export class BattleSessionService {
  private store = new BattleStateStore();
  private metadata = createMetadata();
  private events: BattleEvent[] = [];
  private decisions: DecisionRecord[] = [];
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<BattleSessionSnapshot> {
    try {
      const text = await readFile(this.filePath, 'utf8');
      const saved = validatePersistedSession(JSON.parse(text) as unknown);
      this.restore(saved);
    } catch (error) {
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
      if (code !== 'ENOENT') {
        try {
          await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}.json`);
        } catch {
          // Preserve startup even if a broken file cannot be moved.
        }
      }
      this.store = new BattleStateStore();
      this.metadata = createMetadata();
      this.events = [];
      this.decisions = [];
      await this.persist();
    }
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

  stateSnapshot(): BattleState {
    return this.store.snapshot();
  }

  exportData(): PersistedBattleSession {
    return {
      schemaVersion: 1,
      metadata: structuredClone(this.metadata),
      events: structuredClone(this.events),
      decisions: structuredClone(this.decisions),
    };
  }

  async startNew(input: StartSessionInput = {}): Promise<BattleSessionSnapshot> {
    return this.mutate(async () => {
      this.store = new BattleStateStore();
      this.metadata = createMetadata(input);
      this.events = [];
      this.decisions = [];
      await this.persist();
      return this.snapshot();
    });
  }

  async applyMany(events: readonly BattleEvent[]): Promise<BattleSessionSnapshot> {
    return this.mutate(async () => {
      if (this.metadata.status === 'finished') throw new InputError('終了済みの対戦です。新しい対戦を開始してください。');
      const cloned = structuredClone(events) as BattleEvent[];
      this.store.applyMany(cloned);
      this.events.push(...cloned);
      this.metadata.updatedAt = now();
      await this.persist();
      return this.snapshot();
    });
  }

  async undo(count = 1): Promise<BattleSessionSnapshot> {
    return this.mutate(async () => {
      const normalized = Math.max(1, Math.min(100, Math.trunc(count)));
      this.events.splice(Math.max(0, this.events.length - normalized), normalized);
      this.replayEvents();
      this.decisions = this.decisions.filter((decision) => decision.evaluationRevision <= this.events.length);
      this.metadata.updatedAt = now();
      if (this.metadata.status === 'finished') {
        this.metadata.status = 'active';
        this.metadata.result = null;
        this.metadata.finishedAt = null;
      }
      await this.persist();
      return this.snapshot();
    });
  }

  async importData(value: unknown): Promise<BattleSessionSnapshot> {
    return this.mutate(async () => {
      this.restore(validatePersistedSession(value));
      this.metadata.updatedAt = now();
      await this.persist();
      return this.snapshot();
    });
  }

  async recordDecision(input: RecordDecisionInput): Promise<BattleSessionSnapshot> {
    return this.mutate(async () => {
      const state = this.store.snapshot();
      if (input.evaluationRevision !== state.revision) {
        throw new InputError('評価後に盤面が変化しています。再評価してから採用してください。');
      }
      if (!input.actionId.trim() || !input.label.trim()) throw new InputError('採用する行動が不正です。');
      if (!Number.isFinite(input.score)) throw new InputError('行動スコアが不正です。');
      this.decisions.push({
        id: `decision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: now(),
        evaluationRevision: state.revision,
        turn: state.turn,
        side: input.side,
        kind: input.kind,
        actionId: input.actionId,
        label: input.label.trim(),
        score: input.score,
        actorSlots: [...input.actorSlots],
        notes: input.notes?.trim() || '',
      });
      if (this.decisions.length > 500) this.decisions.splice(0, this.decisions.length - 500);
      this.metadata.updatedAt = now();
      await this.persist();
      return this.snapshot();
    });
  }

  async finish(input: FinishSessionInput): Promise<BattleSessionSnapshot> {
    return this.mutate(async () => {
      const timestamp = now();
      this.metadata.status = 'finished';
      this.metadata.result = input.result ?? 'unknown';
      this.metadata.notes = input.notes?.trim() ?? this.metadata.notes;
      this.metadata.updatedAt = timestamp;
      this.metadata.finishedAt = timestamp;
      await this.persist();
      return this.snapshot();
    });
  }

  private restore(saved: PersistedBattleSession): void {
    this.metadata = structuredClone(saved.metadata);
    this.events = structuredClone(saved.events);
    this.decisions = structuredClone(saved.decisions);
    this.replayEvents();
  }

  private replayEvents(): void {
    this.store = new BattleStateStore();
    this.store.applyMany(this.events);
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.exportData(), null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }
}
