export type SeenStatus = 'live' | 'earlier' | 'none';

export type TeamPerson = {
  id: string; name: string; branch: string; role: string;
  lastSeen: { at: string; lat: number; lng: number; accuracyM: number | null } | null;
  status: SeenStatus; ago: string;
  /** When they agreed to the current wording; null = hasn't, so nothing is kept for them. */
  consentedAt: string | null;
};

export type TrailPoint = { at: string; lat: number; lng: number; accuracyM: number | null };

export type Trail = {
  person: { id: string; name: string; branch: string };
  day: string; points: TrailPoint[]; miles: number; first: string | null; last: string | null;
};

/** One "Locate now" ask and its answer (src/routes/locationRequests.ts). */
export type LocateRequest = {
  id: string; userId: string; status: 'pending' | 'answered' | 'expired';
  requestedAt: string; requestedByName: string; reason: string;
  answeredAt: string | null; lat: number | null; lng: number | null; accuracyM: number | null;
};
