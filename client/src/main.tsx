import { createRoot } from "react-dom/client";
import App from "./App";
import { registerFluxlabServiceWorker } from "./app/register-service-worker";
import "./index.css";

registerFluxlabServiceWorker();
createRoot(document.getElementById("root")!).render(<App />);
