const SMRY_DESKTOP_ZOOM_KEY = "htmlZoom";
const SMRY_DESKTOP_ZOOM = "100%";

document.documentElement.dataset.smryDesktop = "true";

const isSmryDesktopMacos =
  navigator.platform.startsWith("Mac") || navigator.userAgent.includes("Macintosh");

if (isSmryDesktopMacos) {
  document.documentElement.dataset.smryDesktopMacos = "true";
  const titlebarStyle = document.createElement("style");
  titlebarStyle.id = "smry-desktop-titlebar";
  titlebarStyle.textContent = `
  html[data-smry-desktop-macos] {
    --smry-desktop-titlebar-height: 32px;
    background: var(--sidebar);
  }

  html[data-smry-desktop-macos] body {
    box-sizing: border-box !important;
    height: 100dvh !important;
    min-height: 100dvh !important;
    overflow: hidden !important;
    padding-top: var(--smry-desktop-titlebar-height) !important;
  }

  html[data-smry-desktop-macos] body::before {
    content: "";
    position: fixed;
    z-index: 2147483646;
    inset: 0 0 auto;
    height: var(--smry-desktop-titlebar-height);
    background: var(--sidebar);
    pointer-events: none;
  }

  html[data-smry-desktop-macos] [data-app-frame] {
    height: calc(100dvh - var(--smry-desktop-titlebar-height)) !important;
    min-height: calc(100dvh - var(--smry-desktop-titlebar-height)) !important;
  }

  html[data-smry-desktop-macos] [data-app-sidebar] {
    height: 100% !important;
  }
`;
  (document.head ?? document.documentElement).append(titlebarStyle);
}

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
