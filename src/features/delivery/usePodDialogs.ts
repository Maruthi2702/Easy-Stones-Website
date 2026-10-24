import { useState } from 'react';
import { saveDeliveryPod, getDeliveryById } from '../../api/deliverySchedule';
import { API_URL } from '../../config/api';
import { authFetch } from '../../api/authFetch';
import type { PodData } from './pod/PodModal';
import type { Ticket } from './types';

/**
 * The ePOD pop-ups: capture (PodModal) and the signed record (PodViewer).
 * Each opens on the list's copy and swaps in the full record (signatures,
 * photos) when it arrives. A save sends only the ePOD (PATCH …/pod).
 */
export function usePodDialogs({ applyUpdatedList }: { applyUpdatedList: (list: Ticket[] | undefined) => Promise<void> }) {
  // Proof of Delivery (ePOD) Modal state — capture new ePOD
  const [isPodOpen, setIsPodOpen] = useState(false);
  const [selectedPodDelivery, setSelectedPodDelivery] = useState<Ticket | null>(null);

  // ePOD Viewer state — read-only view of signed ePOD
  const [isPodViewerOpen, setIsPodViewerOpen] = useState(false);
  const [viewerDelivery, setViewerDelivery] = useState<Ticket | null>(null);

  const handleOpenPod = async (delivery: Ticket) => {
    setSelectedPodDelivery(delivery);
    setIsPodOpen(true);
    // List fetches omit the raw signature/photo data for speed — pull the full
    // record now that a specific delivery's POD is actually being opened.
    if (delivery?.id) {
      const full = await getDeliveryById(delivery.id);
      if (full) setSelectedPodDelivery(full);
    }
  };

  const handleOpenPodViewer = async (delivery: Ticket) => {
    setViewerDelivery(delivery);
    setIsPodViewerOpen(true);
    if (delivery?.id) {
      const full = await getDeliveryById(delivery.id);
      if (full) setViewerDelivery(full);
    }
  };

  const handleSavePod = async (podData: PodData) => {
    if (!selectedPodDelivery) return;
    // Only the ePOD travels (PATCH /deliveries/:id/pod), never the board's copy
    // of the ticket: sending that back undid whatever the office had edited
    // while the driver was signing, and when the full-record fetch had failed
    // it wrote a transfer's arrival date over its ship date.
    // packingListUrl is untouched for the same reason it always was: it used to
    // be overwritten with the signed copy, which destroyed the only clean
    // source — re-signing then stamped a second certificate onto an
    // already-signed page. The signed version lives at pod.signedPdfUrl.
    const updatedList = await saveDeliveryPod(selectedPodDelivery.id, podData);
    await applyUpdatedList(updatedList);
    setIsPodOpen(false);
  };

  // Voiding a proof keeps the delivery completed — the material arrived; only
  // the signature is withdrawn. The board updates from the socket broadcast.
  const handleClearPod = async (delivery: Ticket, reason: string) => {
    const res = await authFetch(`${API_URL}/api/deliveries/${delivery.id}/pod`, {
      method: 'DELETE',
      body: JSON.stringify({ reason })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to clear the ePOD.');
    }
    const { delivery: updated } = await res.json();
    setViewerDelivery(updated);
    return updated;
  };

  return {
    isPodOpen, setIsPodOpen, selectedPodDelivery, isPodViewerOpen, setIsPodViewerOpen, viewerDelivery,
    handleOpenPod, handleOpenPodViewer, handleSavePod, handleClearPod
  };
}
