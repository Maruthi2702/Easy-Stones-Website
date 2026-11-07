import type { BlockCounts, BlockSize, BlockStage, BundleStatus, LineCoverage, Note, PoLine, PoStage, StepRecord } from '../../utils/supplierBlocks';

export type SuppliersUser = { id?: string; _id?: string; displayName?: string; username?: string; permissions?: string[]; location?: string; assignedLocations?: string[] };

export type HistoryEntry = { at: string; by: string; side?: string; action: string; changes?: string };

export type Bundle = {
  id: string; n: number; slabs: number | null; photoUrl: string; status: BundleStatus; round: number; reason: string;
  comment: Note | null; step1: StepRecord | null; step2: StepRecord | null; previousPhotos: { url: string; at: string | null }[];
  sentAt: string | null; photoAt: string | null; unlock: { by: string; at: string; reason: string } | null;
};

export type Block = {
  id: string; poId: string; poNumber: string; supplierId: string; supplierName: string; supplierCountry: string; supplierTimeZone: string;
  shipTo: string; readyBy: string; poStatus: string; lineId: string; material: string; thickness: string; finish: string;
  blockNumber: string; size: BlockSize | null; note: Note | null; decisionNote: Note | null; bundles: Bundle[];
  stage: BlockStage; counts: BlockCounts; decidable: { 1: string[]; 2: string[] };
  firstSentAt: string | null; sentAt: string | null; createdAt: string | null; updatedAt: string | null; history: HistoryEntry[];
};

export type Po = {
  id: string; poNumber: string; supplierId: string; supplierName: string; supplierCountry: string; shipTo: string; readyBy: string;
  buyerId: string; buyerName: string; lines: PoLine[]; note: Note | null; source: 'typed' | 'sps'; status: 'open' | 'closed' | 'cancelled';
  statusReason: string; assignedAt: string | null; coverage: LineCoverage[]; stage: PoStage;
  blockStages: { review: number; final: number; supplier: number; approved: number; sent: number };
  lastActivityAt: string | null; createdAt: string | null; updatedAt: string | null; createdBy: string;
  history?: HistoryEntry[]; blocks?: Block[]; draftBlocks: number;
};

export type SupplierLoginInfo = {
  id: string; name: string; email: string; language: string; active: boolean; hasPassword: boolean; invitedAt: string | null;
  invitedBy: string; linkExpiresAt: string | null; locked: boolean; lastLoginAt: string | null; lastSeenAt: string | null;
};

export type SupplierRow = {
  id: string; name: string; spsName: string; country: string; language: string; timeZone: string; contactName: string;
  email: string; phone: string; notes: string; active: boolean; logins: SupplierLoginInfo[]; openPos: number;
  score: { bundlesDecided: number; rejectionRate: number | null; retakes: number; supplierHours: number | null; reviewHours: number | null };
};

export type Meta = {
  me: { id: string; name: string };
  today: string;
  languages: readonly { code: string; name: string; english: string }[];
  countries: readonly { name: string; language: string; timeZone: string }[];
  reasons: { reject: readonly string[]; retake: readonly string[] };
  thicknesses: readonly string[];
  finishes: readonly string[];
  buyers: { id: string; name: string }[];
  translation: boolean;
  sameStepAllowed: boolean;
  maxLogins: number;
};

export type SpsLookup = {
  found: boolean; poNumber?: string; supplierName?: string; supplierId?: string; location?: string; eta?: string;
  lines?: { material: string; slabs: number }[]; existingId: string | null;
};

export type IncomingItem = {
  id: string; material: string; thickness: string; finish: string; blockNumber: string; size: BlockSize | null;
  shipTo: string; readyBy: string; bundles: { n: number; slabs: number | null; photoUrl: string }[]; slabs: number; approvedAt: string | null;
};
