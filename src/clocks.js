import { finite, positive } from './geometry.js'

const key = (id, epoch) => JSON.stringify([id, epoch])

/** Freeze an affine conversion per source epoch; reconnect/recalibration needs a new epoch. */
export class ClockRegistry {
  constructor() {
    this.mappings = new Map()
    this.register({
      id: 'session',
      epoch: '0',
      sourceOriginMs: 0,
      sessionOriginMs: 0,
      rate: 1,
      uncertaintyMs: 0,
    })
  }

  register({
    id,
    epoch,
    sourceOriginMs,
    sessionOriginMs,
    rate = 1,
    uncertaintyMs = 0,
    driftUncertaintyPpm = 0,
  }) {
    if (typeof id !== 'string' || !id || typeof epoch !== 'string' || !epoch)
      throw new TypeError('Clock id and epoch are required strings')
    finite(sourceOriginMs, 'sourceOriginMs')
    finite(sessionOriginMs, 'sessionOriginMs')
    positive(rate, 'clock rate')
    finite(uncertaintyMs, 'uncertaintyMs')
    finite(driftUncertaintyPpm, 'driftUncertaintyPpm')
    if (uncertaintyMs < 0 || driftUncertaintyPpm < 0)
      throw new RangeError('Clock uncertainty cannot be negative')
    const mapping = {
      id,
      epoch,
      sourceOriginMs,
      sessionOriginMs,
      rate,
      uncertaintyMs,
      driftUncertaintyPpm,
    }
    const existing = this.mappings.get(key(id, epoch))
    if (existing && JSON.stringify(existing) !== JSON.stringify(mapping))
      throw new Error('Clock epoch is immutable; register a new epoch')
    this.mappings.set(key(id, epoch), Object.freeze(mapping))
    return { ...mapping }
  }

  map(id, epoch, sourceTimeMs) {
    finite(sourceTimeMs, 'sourceTimeMs')
    const m = this.mappings.get(key(id, epoch))
    if (!m) throw new Error(`Unregistered clock epoch: ${id}/${epoch}`)
    const elapsed = (sourceTimeMs - m.sourceOriginMs) * m.rate
    // Affine conversion can lose a few floating-point ULPs. Carry that error as
    // timing uncertainty so exact visual boundaries cannot look falsely precise.
    const identity = m.sourceOriginMs === m.sessionOriginMs && m.rate === 1
    const roundoff = identity
      ? 0
      : 4 *
        Number.EPSILON *
        Math.max(
          1,
          Math.abs(sourceTimeMs),
          Math.abs(m.sourceOriginMs),
          Math.abs(m.sessionOriginMs),
          Math.abs(elapsed),
        )
    const timeMs = identity ? sourceTimeMs : m.sessionOriginMs + elapsed
    const uncertaintyMs =
      m.uncertaintyMs +
      (Math.abs(elapsed) * m.driftUncertaintyPpm) / 1e6 +
      roundoff
    finite(timeMs, 'mapped time')
    finite(uncertaintyMs, 'mapped uncertainty')
    return { timeMs, uncertaintyMs }
  }

  export() {
    return [...this.mappings.values()].map((m) => ({ ...m }))
  }
}
