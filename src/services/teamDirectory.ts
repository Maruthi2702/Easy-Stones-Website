import type { Request } from 'express';
/**
 * The server's side of teamScope.js: reads the staff list (who works where)
 * and answers, for one request, whose work the person sees on the dashboard
 * and who is on their team for Edit/Delete. Read fresh each time — the users
 * collection is small, and a change in Users & Roles applies at once.
 */
import mongoose from 'mongoose';
import User from '../models/User.ts';
import { teammatesOf, visiblePeople, narrowPeople, parseRepsParam, calendarPeople } from '../utils/teamScope.ts';
import { displayNameOf } from '../utils/salesReps.ts';

const staffDirectory = () => User.find({}, '_id location assignedLocations displayName username').lean();

/** The signed-in staff member as teamScope.js reads them. */
export const viewerOf = (req: Request) => ({
  id: String(req.userId || ''),
  permissions: req.user?.permissions,
  assignedLocations: req.user?.assignedLocations
});

/** Who is on this person's team (ALL_PEOPLE or a Set of ids) — for canModifyVisit / canDeleteVisit. */
export const teamOfRequest = async (req: Request) => teammatesOf(viewerOf(req), await staffDirectory());

/** The unfiltered read scope, also used for customer history and single details. */
export const visiblePeopleOfRequest = async (req: Request) => visiblePeople(viewerOf(req), await staffDirectory());

/** Whose entries the dashboard shows, narrowed by ?reps= (People filter) and ?location=. */
export const dashboardPeopleOf = async (req: Request) => {
  const viewer = viewerOf(req);
  const staff = await staffDirectory();
  return narrowPeople(
    visiblePeople(viewer, staff),
    { reps: parseRepsParam(req.query?.reps, viewer.id), location: req.query?.location },
    staff
  );
};

/**
 * Whose calendar entries GET /api/schedule?scope=team sends (teamScope.js's
 * calendarPeople), narrowed by ?reps= and ?location=, and each person's name
 * by id for labelling the entries.
 */
export const calendarPeopleOf = async (req: Request) => {
  const viewer = viewerOf(req);
  const staff = await staffDirectory();
  const people = narrowPeople(
    calendarPeople(viewer, staff),
    { reps: parseRepsParam(req.query?.reps, viewer.id), location: req.query?.location },
    staff
  );
  const nameOf = new Map(staff.map((u) => [String(u._id), displayNameOf(u)]));
  return { people, nameOf };
};

/** An id in every form it may be stored in on a visit or resource. */
export const idVariants = (id: string) =>
  (mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id
    ? [id, new mongoose.Types.ObjectId(id)]
    : [id]);
