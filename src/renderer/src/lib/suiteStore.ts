import { emptySuite, type Suite } from '@shared/automation'

/** The suite the "Bộ test" and "Test tay" tabs both work on (kept in localStorage, same key as before). */
export function loadSuite(): Suite {
  try {
    const v = localStorage.getItem('autoSuite')
    return v ? { ...emptySuite(), ...JSON.parse(v) } : emptySuite()
  } catch {
    return emptySuite()
  }
}

export function saveSuite(s: Suite): void {
  localStorage.setItem('autoSuite', JSON.stringify(s))
}
