"use strict";

(() => {
  const installButton = document.getElementById("installBtn");
  const iosOverlay = document.getElementById("iosInstallOverlay");
  const closeInstallButton = document.getElementById("closeInstallBtn");
  const updateToast = document.getElementById("updateToast");
  const updateButton = document.getElementById("updateBtn");
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let installPrompt = null;
  let waitingWorker = null;
  let reloading = false;

  function revealInstallButton() {
    if (!isStandalone) installButton.classList.remove("hidden");
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    revealInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.classList.add("hidden");
    iosOverlay.classList.add("hidden");
  });

  if (isIOS && !isStandalone) revealInstallButton();

  installButton.addEventListener("click", async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      installButton.classList.add("hidden");
      return;
    }
    iosOverlay.classList.remove("hidden");
  });

  closeInstallButton.addEventListener("click", () => iosOverlay.classList.add("hidden"));
  iosOverlay.addEventListener("click", event => {
    if (event.target === iosOverlay) iosOverlay.classList.add("hidden");
  });

  function showUpdate(worker) {
    waitingWorker = worker;
    updateToast.classList.remove("hidden");
  }

  updateButton.addEventListener("click", () => {
    if (waitingWorker) waitingWorker.postMessage({ type: "SKIP_WAITING" });
  });

  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });

      if (registration.waiting) showUpdate(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdate(worker);
        });
      });

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") registration.update();
      });
    } catch (error) {
      console.warn("Blobbo could not register offline support.", error);
    }
  });
})();
