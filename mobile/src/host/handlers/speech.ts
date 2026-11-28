import { speechPluginFor } from '../../speech/plugin';
import { speechController } from '../../speech/expoRecognizer';

/** The assistant's listening (website → `Speech` plugin). Only builds with this file answer it; older builds fail the call and the web side hides the mic. */
export const Speech = speechPluginFor(speechController);
