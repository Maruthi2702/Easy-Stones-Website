import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { Loose } from '../../types/records';
import { canManageVoiceWords } from '../../utils/voiceWordsAccess';
import VoiceTestPage from '../voiceTest/VoiceTestPage';
import UsageTab from './UsageTab';
import WordsTab from './WordsTab';
import './VoiceWords.css';

/**
 * Admin → Voice Assistant (2026-11-28): Words (the list the assistant is taught from), Usage (turns, failures, cost, never text) and
 * Speech test (the old Voice Test page). Opened by `manage_voice_words` or the admin role (navPins `voice_assistant`); the server checks the
 * same switch on every call, so a person without it gets nothing here and nothing from the API.
 */
const TABS = [['words', 'Words'], ['usage', 'Usage'], ['speech', 'Speech test']] as const;
type TabKey = (typeof TABS)[number][0];

export default function VoiceAssistantPage({ currentUser, sidebarToggle = null }: { currentUser: Loose | null | undefined; sidebarToggle?: ReactNode }) {
  const [tab, setTab] = useState<TabKey>('words');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!canManageVoiceWords(currentUser)) return null;

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    setTab(TABS[next][0]); refs.current[next]?.focus();
  };

  return (
    <div className="vw">
      <div className="vw-inner">
        <header className="vw-head">
          {sidebarToggle}
          <div className="vw-title">
            <h1>Voice Assistant</h1>
            <span>Teach it our words and keep an eye on its use</span>
          </div>
        </header>
        <div className="vw-tabs" role="tablist" aria-label="Voice Assistant">
          {TABS.map(([key, label], i) => (
            <button key={key} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`vw-tab-${key}`} aria-selected={tab === key} aria-controls={`vw-panel-${key}`}
              tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={(e) => onKey(e, i)}>{label}</button>
          ))}
        </div>
        <div role="tabpanel" id={`vw-panel-${tab}`} aria-labelledby={`vw-tab-${tab}`}>
          {tab === 'words' && <WordsTab />}
          {tab === 'usage' && <UsageTab />}
          {tab === 'speech' && <VoiceTestPage embedded />}
        </div>
      </div>
    </div>
  );
}
