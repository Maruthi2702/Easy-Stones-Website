/**
 * Eight bars that follow the voice. They read `--lvl` (0..1), which the sheet writes straight onto its element a few times a
 * frame (no React renders), and move by `transform` only. Each bar has its own reach so they don't move as one.
 */
const REACH = [0.55, 0.9, 1.3, 0.8, 1.15, 0.6, 1.0, 0.45];

export default function LevelBars() {
  return (
    <div className="va-bars" aria-hidden="true">
      {REACH.map((k, i) => <span key={i} style={{ ['--k' as string]: k }} />)}
    </div>
  );
}
