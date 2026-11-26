import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { reloadWhenVersionChanges } from "./app/staleVersion";
import { applyTheme } from "./lib/theme";
import { queryClient } from "./lib/query";
import { attachPerfProbe } from "./offline/perfProbe";
import "./index.css";

attachPerfProbe();
reloadWhenVersionChanges();
applyTheme(); // day, night or sunlight, before the first paint

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
