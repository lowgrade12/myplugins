// Whether a request failed only because Stash reset Apollo's store while it
// was in flight. Stash resets the store each time a scan finishes, so a
// batch of updates rejects every request in flight, many times over. Apollo
// 3's production builds give the message as a code: 42 is "Store reset
// while query was in flight (not completed in link chain)".
export function isStoreReset(e) {
  const text = String(e?.message || e || '')
  if (text.includes('Store reset while query was in flight')) return true
  if (!text.includes('go.apollo.dev/c/err')) return false
  try {
    return /"message"\s*:\s*42\b/.test(decodeURIComponent(text))
  } catch {
    return false
  }
}
