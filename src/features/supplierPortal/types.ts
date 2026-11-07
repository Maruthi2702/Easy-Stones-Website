import type { BlockCounts, BlockSize, BlockStage, BundleStatus, LineCoverage, Note, PoLine, SupplierGroup } from '../../utils/supplierBlocks';

export type PortalMe = { name: string; email: string; language: string; supplierName: string };

export type PortalBundle = {
  id: string; n: number; slabs: number | null; photoUrl: string; status: BundleStatus; round: number;
  decision: string; reason: string; comment: Note | null; earlierPhoto: string; photoAt: string | null; sentAt: string | null;
};

export type PortalBlock = {
  id: string; poId: string; poNumber: string; lineId: string; material: string; thickness: string; finish: string;
  blockNumber: string; size: BlockSize | null; note: Note | null; decisionNote: Note | null; bundles: PortalBundle[];
  stage: BlockStage; counts: BlockCounts; sent: boolean; sentAt: string | null; updatedAt: string | null; poOpen: boolean;
};

export type PortalPo = {
  id: string; poNumber: string; shipTo: string; readyBy: string; lines: PoLine[]; note: Note | null;
  status: 'open' | 'closed' | 'cancelled'; coverage: LineCoverage[]; group: SupplierGroup;
  blocks: (PortalBlock | { id: string; lineId: string; blockNumber: string; stage: BlockStage; needs?: number; draft?: boolean })[];
  updatedAt: string | null; assignedAt: string | null;
};
