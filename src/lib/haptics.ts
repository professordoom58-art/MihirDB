import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'

const native = Capacitor.isNativePlatform()

/** Light tick on each carousel snap / rating step. No-op in the browser. */
export function hapticTick(): void {
  if (native) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {})
}

export function hapticTap(): void {
  if (native) Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
}

export function hapticWarn(): void {
  if (native) Haptics.notification({ type: 'WARNING' as never }).catch(() => {})
}
