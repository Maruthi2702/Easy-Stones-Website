export type SeenStatus = 'live' | 'earlier' | 'none';

export type TeamPerson = {
  id: string; name: string; branch: string; role: string;
  lastSeen: { at: string; lat: number; lng: number; accuracyM: number | null } | null;
  status: SeenStatus; ago: string;
};

export type TrailPoint = { at: string; lat: number; lng: number; accuracyM: number | null };

export type Trail = {
  person: { id: string; name: string; branch: string };
  day: string; points: TrailPoint[]; miles: number; first: string | null; last: string | null;
};
