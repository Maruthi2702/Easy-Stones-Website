// The planner's stop menu and clock for screens outside the Calendar (the Visits tab's Today panel).
// A separate entry from index.ts on purpose: index pulls in the whole planner, and the planner
// keeps a chunk of its own (CalendarPanel lazy-loads it).
export { default as StopActions } from './components/StopActions';
export { default as useNow } from './useNow';
export { isPastStop, nowLineIndex } from './salesPlanner';
import './SalesPlannerWeek.css';
import './SalesPlannerMobile.css';
