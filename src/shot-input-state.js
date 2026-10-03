// A drag previews the trajectory, not the actor's root transform. Only a
// released/committed shot may drive the run-up. AI guard runs are already set.
export function committedKickAim(state) {
  if (state.phase === 'guard') return state.match?.aiAim ?? null;
  return ['runup', 'flight', 'result'].includes(state.phase) ? state.aim : null;
}
