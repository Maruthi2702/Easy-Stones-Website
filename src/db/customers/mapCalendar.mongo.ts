/** MongoDB queries from the map, duplicate check, calendar and private calendar feed. */
import Customer, { type CustomerData } from '../../models/Customer.ts';
import Schedule from '../../models/Schedule.ts';
import { idVariants } from '../../services/teamDirectory.ts';
import type { Loose } from '../../types/records.ts';
import type { CalendarReadQuery } from './types.ts';

export const mapCustomerPins = async (): Promise<Loose[]> => Customer.aggregate([
  { $match: { 'coordinates.lat': { $ne: null } } },
  { $project: {
    company: 1, contactName: 1, city: '$address.city', coordinates: 1,
    precision: '$geocode.precision', salesRep: 1, salesRepName: 1, customerType: 1, status: 1, location: 1,
    lastVisitAt: { $max: '$visits.date' }, visitCount: { $size: { $ifNull: ['$visits', []] } }
  } },
  { $sort: { company: 1, contactName: 1 } }
]);

export const mapCustomerRecord = async (id: string): Promise<Loose | null> => Customer.findById(id)
  .select('phone email marketingEmail address level modaDisplay modaBinder quickNote salesRep location').lean();

export const duplicateSignals = async (): Promise<Loose[]> => Customer.find({}, 'company phone email notDuplicateOf').lean();
export const duplicateCustomers = async (ids: string[]): Promise<Loose[]> => Customer.find(
  { _id: { $in: ids } }, 'company contactName name phone email status location salesRepName address city'
).lean();

/** The route has already decided whose calendars may be read. */
export async function calendarEntries({ people, start, end, feed = false }: CalendarReadQuery): Promise<Loose[]> {
  const query: Loose = people === '*' ? {} : { userId: { $in: [...people].flatMap(idVariants) } };
  if (start && end) query.startTime = { $gte: start, $lte: end };
  if (feed) query.status = { $ne: 'Cancelled' };
  const found = Schedule.find(query)
    .populate<{ customerId: Pick<CustomerData, 'company' | 'contactName' | 'coordinates'> | null }>('customerId',
      feed ? 'contactName company' : 'contactName company coordinates');
  return feed ? found.lean() : found.sort({ startTime: 1 });
}
