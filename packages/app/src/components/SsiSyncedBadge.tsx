// Shown on a dive that has been synced to SSI (whether uploaded by us or linked
// to an existing SSI record by the timestamp reconcile step): the SSI logo next
// to that dive's SSI dive number. Display only -- no link.
import ssiLogo from '../assets/ssi-logo.png';

export function SsiSyncedBadge({ diveNumber }: { diveNumber: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-500"
      title={`Synced to SSI as dive #${diveNumber}`}
    >
      <img src={ssiLogo} alt="SSI" className="h-4 w-auto" />#{diveNumber}
    </span>
  );
}
