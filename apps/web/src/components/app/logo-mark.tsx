/** The product mark: an endpoint whose signal, under load, resolves into a check. Same drawing as
 * the favicon and the desktop icon, in the current text color. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="4 4 56 56" fill="none" aria-hidden="true" className={className}>
      <path d="M13 33H17L21.5 22L27.5 44L31 33H36L41 38L52 24" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="33" r="4.5" fill="currentColor" />
    </svg>
  );
}
