// Preserve the captured finish, but let its last quarter-second come to rest.
// Integrating a quintic pace fall gives unit speed/zero acceleration on entry
// and zero speed/acceleration on exit, without speeding up or reversing time.
export const RECOVERY_SOURCE_TAIL=.25;

export function recoveryAfterTime(after,contact,duration,tail=RECOVERY_SOURCE_TAIL){
  const end=duration-contact,start=end-tail;
  if(after<=start)return Math.max(0,after);
  const u=(after-start)/(2*tail);
  if(u>=1)return end;
  return start+2*tail*(u-u**4*(2.5-3*u+u*u));
}
