import { useState, useEffect, useCallback, useRef } from 'react';

const EDGE_ZONE = 64;
const EDGE_TICK_MS = 60;
const EDGE_FLIP_MS = 780;

/**
 * Held against the side, the calendar moves under the card. Without this,
 * putting a stop into next week is two separate moves, and the second one
 * is a different gesture from the first.
 *
 * Scrolling comes first — on a narrow window the five columns are already
 * wider than the screen — and only once there is nothing left to scroll in
 * that direction does the dwell start counting towards a week flip.
 *
 * `stepPeriod` is read when the timer ticks, not when it started: the view can
 * change under a running drag.
 */
export default function useEdgeFlip(stepPeriod: (dir: number) => void) {
    const [edgeDir, setEdgeDir] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const edge = useRef<{ dir: number; timer: ReturnType<typeof setInterval> | null; held: number }>({ dir: 0, timer: null, held: 0 });
    const latestStep = useRef(stepPeriod);
    // eslint-disable-next-line react-hooks/refs -- read by the timer, as the one `latest` ref was before the split
    latestStep.current = stepPeriod;

    const stopEdge = useCallback(() => {
        // Called from every dragover that is not near an edge, which is most of
        // them.
        if (!edge.current.dir && !edge.current.timer) return;
        if (edge.current.timer) clearInterval(edge.current.timer);
        edge.current = { dir: 0, timer: null, held: 0 };
        setEdgeDir(0);
    }, []);

    const startEdge = useCallback((dir: number, { scroll = true }: { scroll?: boolean } = {}) => {
        if (edge.current.dir === dir) return;
        stopEdge();
        edge.current.dir = dir;
        setEdgeDir(dir);

        edge.current.timer = setInterval(() => {
            const el = scrollRef.current;
            const room = el ? el.scrollWidth - el.clientWidth : 0;
            const at = el ? el.scrollLeft : 0;

            if (scroll && el && room > 0 && (dir < 0 ? at > 0 : at < room)) {
                el.scrollLeft = at + dir * 26;
                edge.current.held = 0;
                return;
            }

            edge.current.held += EDGE_TICK_MS;
            if (edge.current.held < EDGE_FLIP_MS) return;
            edge.current.held = 0;
            latestStep.current(dir);
        }, EDGE_TICK_MS);
    }, [stopEdge]);

    /** Called with every pointer position a running drag reports. */
    const edgeAssist = useCallback((x: number) => {
        const el = scrollRef.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        if (x < box.left + EDGE_ZONE) startEdge(-1);
        else if (x > box.right - EDGE_ZONE) startEdge(1);
        else stopEdge();
    }, [startEdge, stopEdge]);

    useEffect(() => stopEdge, [stopEdge]);

    return { edgeDir, scrollRef, startEdge, stopEdge, edgeAssist };
}

export type EdgeFlip = ReturnType<typeof useEdgeFlip>;
