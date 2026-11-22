export type SeenStatus = 'live' | 'earlier' | 'none';

export type TeamPerson = {
  id: string; name: string; branch: string; role: string;
  lastSeen: { at: string; lat: number; lng: number; accuracyM: number | null } | null;
  status: SeenStatus; ago: string;
  /** When they agreed to the current wording; null = hasn't, so nothing is kept for them. */
  consentedAt: string | null;
  /** Is tracking on for them right now (their workday and hours)? */
  windowNow?: boolean;
  /** Why a person who should be reporting isn't (src/utils/locationHealth.ts), or null. */
  quiet?: { code: string; text: string } | null;
  /** What their phone last said about itself (a heartbeat), or null if it never has. */
  device?: { permission: string; lowPower: boolean; batteryPct: number | null; charging: boolean; queued: number; appVersion: string; reportedAt: string } | null;
};

export type TrailPoint = { at: string; lat: number; lng: number; accuracyM: number | null };

export type Trail = {
  person: { id: string; name: string; branch: string };
  day: string; points: TrailPoint[]; miles: number; first: string | null; last: string | null;
  /** Stretches with no data (the phone was off, dead or had no signal); the map never joins across them. */
  gaps?: { from: string; to: string; minutes: number }[];
};

/** One line of the access log: who looked at whose location (src/routes/locationTracking.ts `/access-log`). */
export type AccessEntry = { id: string; viewerId: string; viewerName: string; subjectId: string; subjectName: string; kind: 'live' | 'trail' | 'locate'; day: string; at: string };

/** One "Locate now" ask and its answer (src/routes/locationRequests.ts). */
export type LocateRequest = {
  id: string; userId: string; status: 'pending' | 'answered' | 'expired';
  requestedAt: string; requestedByName: string; reason: string;
  answeredAt: string | null; lat: number | null; lng: number | null; accuracyM: number | null;
};
