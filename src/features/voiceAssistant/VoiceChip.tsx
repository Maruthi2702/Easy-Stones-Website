import { Mic } from 'lucide-react';
import '../location/Location.css';
import './VoiceAssistant.css';

/**
 * "Voice": this visit was logged by talking to the assistant (`visit.byVoice`, kept by the server only from someone holding the
 * switch). Shown beside the location chip in the Visit view, the dashboard's Visits list and the customer's Visits tab.
 */
export default function VoiceChip({ byVoice }: { byVoice?: unknown }) {
  if (byVoice !== true) return null;
  return (
    <span className="loc-chip loc-chip--voice" title="Logged by voice">
      <Mic size={11} aria-hidden="true" />
      Voice
    </span>
  );
}
