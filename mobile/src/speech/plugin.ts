import type { PluginImpl } from '../host/protocol';
import type { SpeechController, SpeechEvents } from './core';

/**
 * The bridge's `Speech` plugin (contract: src/utils/assistantContract.ts `SpeechPlugin`) over a controller. The controller is asked for
 * lazily so importing this never touches the native module. Calls: available, requestPermission, start({ hints, lang }), stop → { text },
 * abort. Events (addListener): `partial` { text }, `level` { level }, `error` { code, message }.
 */
export function speechPluginFor(getController: () => SpeechController): PluginImpl {
  const event = <K extends keyof SpeechEvents>(name: K) => (emit: (data: unknown) => void) => getController().on(name, (d) => emit(d));
  return {
    calls: {
      available: () => getController().available(),
      requestPermission: () => getController().requestPermission(),
      start: async (o: { hints?: string[]; lang?: string }) => { await getController().start({ hints: o?.hints ?? [], lang: typeof o?.lang === 'string' ? o.lang : undefined }); return {}; },
      stop: () => getController().stop(),
      abort: async () => { await getController().abort(); return {}; }
    },
    callbacks: {},
    events: { partial: event('partial'), level: event('level'), error: event('error') }
  };
}
