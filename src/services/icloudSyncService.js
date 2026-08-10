import User from '../models/User.js';
import Schedule from '../models/Schedule.js';
import Customer from '../models/Customer.js';
import https from 'https';

// Resolves relative CalDAV paths (like /123456/principal/) to full URLs
const resolveUrl = (baseUrl, href) => {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  const origin = new URL(baseUrl).origin;
  return origin + (href.startsWith('/') ? href : '/' + href);
};

const makeDavRequest = (url, method, body, username, password, depth = '0', contentType = 'application/xml; charset=utf-8') => {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const auth = Buffer.from(`${String(username).trim()}:${String(password).trim()}`).toString('base64');

    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': contentType,
        'Depth': depth,
        'User-Agent': 'EasyStonesCalDAVClient/1.0'
      }
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`iCloud CalDAV server returned status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
};

// Discover principal and calendar-home-set URLs for an iCloud user
export const discoverICloudCalendars = async (username, password) => {
  const baseUrl = 'https://caldav.icloud.com';
  
  // 1. Find Principal URL
  const principalXml = `<?xml version="1.0" encoding="utf-8" ?>
    <d:propfind xmlns:d="DAV:">
      <d:prop>
        <d:current-user-principal/>
      </d:prop>
    </d:propfind>`;
  
  const principalRes = await makeDavRequest(baseUrl, 'PROPFIND', principalXml, username, password, '0');
  const principalMatch = principalRes.match(/<(?:[a-zA-Z0-9_-]+:)?current-user-principal>\s*<(?:[a-zA-Z0-9_-]+:)?href>([^<]+)<\/(?:[a-zA-Z0-9_-]+:)?href>/i);
  
  if (!principalMatch) {
    throw new Error('Failed to find principal calendar set. Please verify your Apple ID and App-Specific Password.');
  }
  
  const principalUrl = resolveUrl(baseUrl, principalMatch[1]);

  // 2. Find Calendar Home Set URL (handles iCloud redirects to pXX sharded servers)
  const homeXml = `<?xml version="1.0" encoding="utf-8" ?>
    <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop>
        <c:calendar-home-set/>
      </d:prop>
    </d:propfind>`;
  
  const homeRes = await makeDavRequest(principalUrl, 'PROPFIND', homeXml, username, password, '0');
  const homeMatch = homeRes.match(/<(?:[a-zA-Z0-9_-]+:)?calendar-home-set>\s*<(?:[a-zA-Z0-9_-]+:)?href>([^<]+)<\/(?:[a-zA-Z0-9_-]+:)?href>/i);
                    
  if (!homeMatch) {
    throw new Error('Failed to find calendar home set.');
  }
  
  const calendarHomeUrl = resolveUrl(principalUrl, homeMatch[1]);

  // 3. Find Calendars
  const listXml = `<?xml version="1.0" encoding="utf-8" ?>
    <d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
      <d:prop>
        <d:displayname/>
        <c:supported-calendar-component-set/>
      </d:prop>
    </d:propfind>`;
  
  const listRes = await makeDavRequest(calendarHomeUrl, 'PROPFIND', listXml, username, password, '1');
  
  // Parse DAV multi-responses to list calendars
  const calendars = [];
  const responses = listRes.split(/<d:response>|<response>/i);
  responses.shift(); // remove header
  
  for (const resp of responses) {
    const hrefMatch = resp.match(/<(?:[a-zA-Z0-9_-]+:)?href>([^<]+)<\/(?:[a-zA-Z0-9_-]+:)?href>/i);
    const nameMatch = resp.match(/<(?:[a-zA-Z0-9_-]+:)?displayname>([^<]+)<\/(?:[a-zA-Z0-9_-]+:)?displayname>/i);
    
    // Check if calendar supports VEVENT component
    const supportsVEvent = resp.includes('VEVENT');
    
    if (hrefMatch && nameMatch && supportsVEvent) {
      calendars.push({
        name: nameMatch[1],
        url: resolveUrl(calendarHomeUrl, hrefMatch[1])
      });
    }
  }
  
  return calendars;
};

// Inline iCalendar (.ics) text parser
const parseIcsEvents = (icsText) => {
  const events = [];
  const parts = icsText.split('BEGIN:VEVENT');
  parts.shift(); // remove header
  
  for (const part of parts) {
    const eventText = part.split('END:VEVENT')[0];
    
    const getValue = (key) => {
      // Find key matching value on same line, handle CRLF and folds
      const match = eventText.match(new RegExp(`(?:^|\\r?\\n)${key}[^:]*:(.*(?:\\r?\\n\\s+.*)*)`));
      if (!match) return '';
      // Clean up folded lines
      return match[1].replace(/\r?\n\s+/g, '').trim();
    };
    
    // Helper to format iCal standard dates (YYYYMMDDTHHmmssZ) to standard JS dates
    const parseIcsDate = (dateStr) => {
      if (!dateStr) return null;
      // Clean timezone arguments
      const cleanDate = dateStr.replace(/VALUE=DATE:/, '');
      if (/^\d{8}$/.test(cleanDate)) {
        // All-day date (YYYYMMDD)
        const year = parseInt(cleanDate.substring(0, 4));
        const month = parseInt(cleanDate.substring(4, 6)) - 1;
        const day = parseInt(cleanDate.substring(6, 8));
        return new Date(year, month, day);
      }
      const match = cleanDate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/);
      if (match) {
        const [_, y, m, d, hh, mm, ss, z] = match;
        if (z) {
          return new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
        }
        return new Date(y, m - 1, d, hh, mm, ss);
      }
      return new Date(dateStr);
    };

    const summary = getValue('SUMMARY');
    const description = getValue('DESCRIPTION');
    const dtstartRaw = getValue('DTSTART');
    const dtendRaw = getValue('DTEND');
    const uid = getValue('UID');
    
    if (uid) {
      events.push({
        uid,
        summary,
        description,
        startTime: parseIcsDate(dtstartRaw),
        endTime: parseIcsDate(dtendRaw)
      });
    }
  }
  return events;
};

/**
 * Sync iCloud Calendar both ways.
 *
 * Returns whether anything on the planner side actually moved, so the caller
 * can tell open planners to refetch — a sync that found nothing new should not
 * make every browser ask again.
 */
export const syncICloudCalendar = async (userId) => {
  let plannerChanged = false;
  try {
    const user = await User.findById(userId);
    if (!user || !user.icloudSyncEnabled || !user.icloudCalendarUrl) {
      return false;
    }

    const { icloudUsername, icloudPassword, icloudCalendarUrl } = user;

    // Fetch events in a 120-day window (past 30 days to next 90 days)
    const pad = (n) => String(n).padStart(2, '0');
    const formatCalDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T000000Z`;

    const startFilter = new Date();
    startFilter.setDate(startFilter.getDate() - 30);
    const endFilter = new Date();
    endFilter.setDate(endFilter.getDate() + 90);

    // 1. iCloud -> Sales Planner Sync (Fetch latest iCloud events via REPORT request)
    const queryXml = `<?xml version="1.0" encoding="utf-8" ?>
      <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
        <d:prop>
          <d:getetag/>
          <c:calendar-data/>
        </d:prop>
        <c:filter>
          <c:comp-filter name="VCALENDAR">
            <c:comp-filter name="VEVENT">
              <c:time-range start="${formatCalDate(startFilter)}" end="${formatCalDate(endFilter)}"/>
            </c:comp-filter>
          </c:comp-filter>
        </c:filter>
      </c:calendar-query>`;

    const queryRes = await makeDavRequest(icloudCalendarUrl, 'REPORT', queryXml, icloudUsername, icloudPassword, '1');
    const events = parseIcsEvents(queryRes);

    for (const event of events) {
      const isSyncedFromApp = event.description && event.description.includes('EasyStones ID:');
      if (isSyncedFromApp) {
        continue;
      }

      const existingImport = await Schedule.findOne({
        userId,
        notes: new RegExp(`iCloud ID: ${event.uid}`)
      });

      if (!event.startTime) continue;

      if (existingImport) {
        existingImport.startTime = event.startTime.toISOString();
        existingImport.endTime = event.endTime ? event.endTime.toISOString() : event.startTime.toISOString();
        existingImport.notes = `iCloud Event\n[iCloud ID: ${event.uid}]\n\n${event.description || ''}`;
        await existingImport.save();
      } else {
        let syncCustomer = await Customer.findOne({ company: 'iCloud Calendar Sync' });
        if (!syncCustomer) {
          syncCustomer = new Customer({
            company: 'iCloud Calendar Sync',
            contactName: 'iCloud Event Sync',
            phone: '000-000-0000',
            email: 'icloud-sync@easystones.com',
            status: 'Lead'
          });
          await syncCustomer.save();
        }

        const newItem = new Schedule({
          userId,
          customerId: syncCustomer._id,
          startTime: event.startTime.toISOString(),
          endTime: event.endTime ? event.endTime.toISOString() : event.startTime.toISOString(),
          activityType: 'Other',
          notes: `iCloud Event\n[iCloud ID: ${event.uid}]\n\n${event.description || ''}`,
          status: 'Scheduled'
        });
        await newItem.save();
        plannerChanged = true;
      }
    }

    // 2. Sales Planner -> iCloud Sync (Upload app schedules to iCloud)
    const appSchedules = await Schedule.find({
      userId,
      notes: { $not: /iCloud ID:/ },
      status: { $ne: 'Cancelled' }
    }).populate('customerId', 'contactName company');

    const formatIcsDate = (dateVal) => {
      const d = new Date(dateVal);
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    };

    for (const schedule of appSchedules) {
      const syncedMatch = schedule.notes && schedule.notes.match(/Synced to iCloud UID: ([a-zA-Z0-9_-]+)/);
      const uid = syncedMatch ? syncedMatch[1] : `${schedule._id}-easystones`;
      
      const clientName = schedule.customerId 
        ? (schedule.customerId.company || schedule.customerId.contactName || 'Unnamed Customer') 
        : 'Unknown Customer';
      
      const summary = `${schedule.activityType || 'Visit'} - ${clientName}`;
      const description = `${schedule.notes || ''}\\n\\n[EasyStones ID: ${schedule._id}]`;
      const startStr = formatIcsDate(schedule.startTime);
      const endStr = formatIcsDate(schedule.endTime || new Date(schedule.startTime).getTime() + 3600000);

      // Construct raw VCALENDAR event
      const icsEvent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//EasyStones//iCloudSync//EN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${formatIcsDate(new Date())}`,
        `DTSTART:${startStr}`,
        `DTEND:${endStr}`,
        `SUMMARY:${summary}`,
        `DESCRIPTION:${description}`,
        'STATUS:CONFIRMED',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n');

      const eventUrl = icloudCalendarUrl.endsWith('/') ? `${icloudCalendarUrl}${uid}.ics` : `${icloudCalendarUrl}/${uid}.ics`;

      // Upload/Sync event to iCloud server via PUT request
      await makeDavRequest(eventUrl, 'PUT', icsEvent, icloudUsername, icloudPassword, '0', 'text/calendar; charset=utf-8');

      if (!syncedMatch) {
        schedule.notes = `${schedule.notes || ''}\n\n[Synced to iCloud UID: ${uid}]`;
        await schedule.save();
        plannerChanged = true;
      }
    }
  } catch (err) {
    console.error(`Error in syncICloudCalendar for user ${userId}:`, err);
  }
  return plannerChanged;
};
