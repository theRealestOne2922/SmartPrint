// Which physical kiosk this browser is.
//
// Both kiosks run the byte-identical bundle from one Firebase Hosting site —
// the /kiosk-app/** rewrite is a catch-all glob that ignores the query string,
// so the only thing telling them apart is the ?kiosk=<id> in the URL each Pi's
// Chromium is launched with. No second build, no second hosting site.
//
// Persisted, and that part matters more than it looks. The app routes
// client-side (wouter), so by the time anyone releases a job the address bar
// reads /kiosk-app/confirm/ABC123 with no query string left on it. A Chromium
// restart or a reload on that path would come back with no idea which kiosk it
// is — and once both Pi agents only claim jobs stamped with their own
// KIOSK_ID, a release carrying no kioskId is claimed by neither of them and
// sits at "printing" until someone notices. localStorage rather than
// sessionStorage because the kiosk is a dedicated machine whose browser gets
// restarted, and the stored value has to outlive that.
//
// The URL always wins when it is present, so re-pointing a Pi at a different
// ?kiosk= takes effect on its next load with nothing to clear by hand.
const STORAGE_KEY = 'smartprint_kiosk_id';

function resolveKioskId(): string | null {
  let fromUrl: string | null = null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get('kiosk');
  } catch {
    fromUrl = null;
  }

  const trimmed = fromUrl?.trim();
  if (trimmed) {
    // Private browsing and locked-down profiles can throw on write. Losing the
    // persistence is survivable; taking the whole kiosk down over it is not.
    try {
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      /* keep the in-memory value regardless */
    }
    return trimmed;
  }

  try {
    return window.localStorage.getItem(STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

// Resolved once, at module load, so every screen agrees on the answer for the
// life of the page no matter what the address bar has been rewritten to since.
const KIOSK_ID = resolveKioskId();

export function getKioskId(): string | null {
  return KIOSK_ID;
}
