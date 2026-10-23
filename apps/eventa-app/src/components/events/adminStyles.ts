export const adminPage = 'mx-auto w-full max-w-[94rem] px-[clamp(1rem,4vw,3rem)] py-[clamp(2rem,5vw,4.5rem)] max-[560px]:px-4 max-[560px]:py-6';

export const backLink = 'inline-flex min-h-11 items-center gap-2 rounded-lg px-2 py-2 text-xs font-bold text-[var(--muted)] no-underline hover:bg-[var(--soft)] hover:text-[var(--ink)]';

export const formAlert = 'rounded-xl border border-red-700/20 bg-[var(--danger-soft)] px-4 py-3 text-[13px] font-semibold leading-relaxed text-[#812a24]';

export const primaryLink = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--evergreen)] px-4 text-sm font-bold text-white no-underline hover:opacity-90';

export const secondaryLink = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm font-bold text-[var(--ink)] no-underline hover:bg-[var(--soft)]';

export const dialogBackdrop = 'fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#071f19]/60 p-4 backdrop-blur-[2px]';

export const confirmationDialog = 'relative w-full max-w-[29rem] rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 shadow-[0_24px_70px_rgb(7_31_25_/_25%)]';

export const dialogClose = 'absolute top-4 right-4 grid size-9 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--soft)] hover:text-[var(--ink)] [&_svg]:size-4';

export const dialogActions = 'flex flex-col justify-end gap-3 min-[561px]:flex-row';

export function statusBadge(status: string) {
  const color = status === 'draft'
    ? 'bg-[#f8ead2] text-[#825116]'
    : status === 'published'
      ? 'bg-[rgb(11_89_69_/_11%)] text-[var(--evergreen-deep)]'
      : 'bg-[var(--danger-soft)] text-[var(--danger)]';
  return `shrink-0 rounded-full px-3 py-1.5 text-[11px] font-extrabold capitalize ${color}`;
}
