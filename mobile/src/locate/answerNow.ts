import * as Location from 'expo-location';
import * as api from '../collector/api';
import { makeAnswerer } from './locateRequests';

/** The one position an ask wants: the best the phone can give, within 20 s. Needs location allowed (foreground is enough). */
async function position() {
  if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
  try {
    const p = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 20_000))
    ]);
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null };
  } catch { return null; }
}

const run = makeAnswerer({ now: () => Date.now(), load: api.loadOpenRequests, position, send: api.sendRequestAnswer });

/** Look for open "Locate now" asks and answer them. Call only for a tracked person who has agreed. */
export const answerLocateRequests = (force = false) => run(force).catch(() => 0);
