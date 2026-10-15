export type RiskLevel = 'red' | 'yellow' | 'green';

export type DialogueStage = 'opening' | 'followup' | 'closing';

export interface SessionBrief {
  id: string;
  buyer: string;
  startTime: string;
  endTime: string;
  sceneKey: string;
  sceneMajor: string;
  sceneMinor: string;
  msgs: number;
  images: number;
  hasOrder: boolean;
  ticketKinds: string[];
  preview: string;
  demo: { id: string; title: string; tone: string; tag: string; desc: string } | null;
  riskLevel: RiskLevel;
  riskPeak: number;
  engineScene: string;
  tryMode?: boolean;
}

export interface ChatMessage {
  seq: number;
  time: string;
  role: string;
  sender: string;
  isBuyer: boolean;
  isSystem?: boolean;
  runtime?: boolean;
  simulated?: boolean;
  extra?: boolean;
  live?: boolean;
  text: string;
  contentType: string;
  imageUrl: string | null;
  imagePath?: string | null;
  sceneMajor?: string;
  sceneMinor?: string;
  category?: string;
  orderId?: string;
  ticketId?: string;
}

export interface Ticket {
  kind: string;
  kindLabel: string;
  id?: string;
  [k: string]: unknown;
}

export interface FusionTicket {
  kind: string;
  kindLabel: string;
  id: string;
  reason: string;
  status: string;
  detail?: string;
  createdAt?: string;
  doneAt?: string;
}

export interface FusionOrder {
  id?: string;
  sku?: string;
  name?: string;
  qty?: string;
  unitPrice?: number;
  amount?: number;
  status?: string;
  orderedAt?: string;
  shippedAt?: string;
  courier?: string;
  tracking?: string;
  region?: string;
  gift?: string;
  note?: string;
}

export interface Fusion {
  buyer: {
    nickname: string;
    visits: number;
    totalOrders: number;
    totalSpend: number;
    priorTickets: Array<{ kindLabel: string; id: string; reason: string; status: string }>;
    priorSessionIds: string[];
  };
  order: FusionOrder | null;
  tickets: FusionTicket[];
  sources: Array<{ key: string; label: string; ok: boolean; detail: string }>;
  highlights: string[];
}

export interface EmotionPoint {
  seq: number;
  raw: number;
  value: number;
  hits?: string[];
  text?: string;
}

export interface EmotionCurve {
  points: EmotionPoint[];
  turns: Array<{ seq: number; dir: 'up' | 'down'; delta: number }>;
  peak: { seq: number; value: number; snippet?: string } | null;
  current: { seq: number; value: number } | null;
  state: string;
  blended?: boolean;
  llmWeight?: number;
  source?: string;
}

export interface RiskAction {
  code: string;
  label: string;
  kind: string;
}

export interface Risk {
  level: RiskLevel;
  sceneKey: string;
  reasons: string[];
  actions: RiskAction[];
  compliance: string[];
}

export interface EvalCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface Evaluation {
  checks: EvalCheck[];
  matched: string[];
  missing: string[];
  pass: boolean | null;
  summary: string;
  tryMode?: boolean;
}

export interface GroundTruth {
  topScene: string;
  tickets: Array<{ kindLabel: string; id: string; reason: string; status: string }>;
  outcomes: Array<{ code: string; label: string; evidence: string }>;
  level: RiskLevel | '';
  expectedActions: string[];
  tryMode?: boolean;
}

export interface Evidence {
  source: string;
  category: string;
  imageUrl: string;
  seq?: number;
  verdict?: string;
  findings?: string[];
  support?: string;
  suggestion?: string;
  error?: string;
}

export interface Analysis {
  sessionId: string;
  uptoSeq: number;
  fusion: Fusion;
  sceneKey: string;
  stage?: DialogueStage;
  intent: {
    timeline: Array<{ seq: number; major: string; minor: string; intent: string; sceneKey: string }>;
    dominant: Array<{ major: string; minor: string; count: number; score?: number }>;
    switched: boolean;
  };
  lastBuyer: { seq: number; text: string; contentType: string; imageUrl: string | null } | null;
  emotion: EmotionCurve;
  risk: Risk;
  evaluation: Evaluation;
  groundTruth: GroundTruth;
  summary: string | { headline: string; focus: string[]; reasoning?: string; source: string };
  reply: string | { text: string; tone?: string; notes: string[]; source: string };
  evidence: Evidence | null;
  engine: 'rules' | 'agent';
  llm: boolean;
  llmModels?: { text: string; vl: string } | null;
  elapsedMs?: number;
}

export interface TraceStep {
  id: string;
  label: string;
  status: 'running' | 'done' | 'fallback' | 'skipped' | 'rules';
  detail?: string;
  ms?: number;
}

export interface SessionDetail {
  id: string;
  buyer: string;
  shop: string;
  startTime: string;
  endTime: string;
  stats: { msgs: number; buyerMsgs: number; images: number };
  demo: SessionBrief['demo'];
  scenes: Array<{ major: string; minor: string; count: number }>;
  messages: ChatMessage[];
  order: Record<string, unknown> | null;
  tickets: Ticket[];
  analysis: Analysis;
  runtime: { actions: ActionRecord[]; actionDefs: Array<{ type: string; label: string }> };
}

export interface ActionRecord {
  id: string;
  type: string;
  label: string;
  at: string;
  status: string;
  fields: Record<string, unknown>;
}

export interface Overview {
  stats: {
    sessions: number;
    messages: number;
    buyerMessages: number;
    images: number;
    orders: number;
    tickets: number;
    buyers: number;
    sessionsWithOrder: number;
    sessionsWithTicket: number;
  };
  llm: { available: boolean; textModel: string; vlModel: string };
  storage: { mode: 'mysql' | 'memory'; reason?: string; host?: string | null; database?: string | null };
  demo: Array<{ id: string; title: string; tone: string; tag: string; desc: string }>;
  riskCount: Record<RiskLevel, number>;
  agreement: Record<string, number>;
  actions: Array<{ type: string; label: string }>;
}

export interface InsightSession {
  id: string;
  buyer: string;
  sceneKey: string;
  sceneMajor: string;
  gtScene: string;
  level: RiskLevel;
  gtLevel: RiskLevel;
  peak: number;
  current: number;
  switched: boolean;
  demo: boolean;
  evalPass: boolean;
  sceneOk: boolean;
  levelOk: boolean;
  actionOk: boolean;
  missing: string[];
  msgs: number;
  ticketKinds: string[];
  topReason: string;
}

// riskSessions / topUpset 是精简投影（pick()），字段不全
export type InsightSessionBrief = Pick<InsightSession, 'id' | 'buyer' | 'sceneKey' | 'level' | 'peak' | 'msgs' | 'demo' | 'topReason'>;

export interface Insights {
  stats: Overview['stats'];
  riskCount: Record<RiskLevel, number>;
  agreement: Record<string, number>;
  riskSessions: { red: InsightSessionBrief[]; yellow: InsightSessionBrief[] };
  topUpset: InsightSessionBrief[];
  sceneDistribution: Array<{ key: string; count: number }>;
  ticketHotspots: Array<{ kind: string; reason: string; count: number }>;
  mismatches: InsightSession[];
  perSession: InsightSession[];
}

export type StreamEvent =
  | { type: 'step'; id: string; label: string; status: TraceStep['status']; detail?: string; ms?: number }
  | { type: 'partial'; key: string; value: unknown }
  | { type: 'reply_delta'; text: string }
  | { type: 'done'; analysis: Analysis }
  | { type: 'error'; message: string };
