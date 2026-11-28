/** The Easy Surfaces gold mark. It turns only while the assistant is listening or working (`spinning`), and rests otherwise. */
export default function Logo({ spinning = false, size = 24 }: { spinning?: boolean; size?: number }) {
  return <img className={`va-logo${spinning ? ' is-spinning' : ''}`} src="/favicon.png" alt="" aria-hidden="true" height={size} draggable={false} />;
}
