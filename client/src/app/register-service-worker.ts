export type FluxlabServiceWorkerStatus = "installing" | "offline-ready" | "update-waiting" | "error";

type Listener = (status: FluxlabServiceWorkerStatus) => void;

let current: FluxlabServiceWorkerStatus = "installing";
const listeners = new Set<Listener>();
let registered = false;

export function getFluxlabServiceWorkerStatus() {
  return current;
}

export function subscribeFluxlabServiceWorker(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

function setStatus(status: FluxlabServiceWorkerStatus) {
  current = status;
  for (const listener of listeners) listener(status);
}

async function requiredEngineCached() {
  if (!("caches" in globalThis)) return false;
  const names = await caches.keys();
  const urls: string[] = [];
  for (const name of names) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) urls.push(request.url);
  }
  return urls.some(url => /simulator\.worker-[^/?#]+\.js(?:$|[?#])/.test(url)) && urls.some(url => /\.wasm(?:$|[?#])/.test(url));
}

async function waitUntilEngineCached(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await requiredEngineCached()) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function watchInstalling(worker: ServiceWorker | null) {
  if (!worker) return;
  setStatus("installing");
  worker.addEventListener("statechange", () => {
    if (worker.state !== "installed") return;
    void (async () => {
      if (navigator.serviceWorker.controller) {
        setStatus("update-waiting");
        return;
      }
      setStatus((await waitUntilEngineCached()) ? "offline-ready" : "error");
    })();
  });
}

export function registerFluxlabServiceWorker() {
  if (registered) return;
  registered = true;
  if (!("serviceWorker" in navigator)) {
    setStatus("error");
    return;
  }
  setStatus("installing");
  void navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then(registration => {
      if (registration.waiting) setStatus("update-waiting");
      else if (registration.installing) watchInstalling(registration.installing);
      else {
        void waitUntilEngineCached().then(ready => setStatus(ready ? "offline-ready" : "installing"));
      }
      registration.addEventListener("updatefound", () => watchInstalling(registration.installing));
    })
    .catch(() => setStatus("error"));
}
