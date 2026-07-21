const SMRY_DESKTOP_ZOOM_KEY = "htmlZoom";
const SMRY_DESKTOP_ZOOM = "100%";

document.documentElement.dataset.smryDesktop = "true";

function resetSmryDesktopZoom() {
  try {
    window.localStorage.setItem(SMRY_DESKTOP_ZOOM_KEY, SMRY_DESKTOP_ZOOM);
  } catch {
    // Native zoom still resets even when site storage is unavailable.
  }

  const invoke = window.__TAURI__?.core?.invoke;
  if (invoke) {
    invoke("set_zoom", { percent: 100 }).catch(() => {});
  }
}

// Pake persists zoom in smry.ai localStorage and restores that value before
// custom code runs. Always return the product shell to its designed scale.
// Replacing Pake's global helpers also prevents its menu accelerators from
// reintroducing a zoom that survives the next launch.
window.setZoom = resetSmryDesktopZoom;
window.zoomIn = resetSmryDesktopZoom;
window.zoomOut = resetSmryDesktopZoom;

resetSmryDesktopZoom();
