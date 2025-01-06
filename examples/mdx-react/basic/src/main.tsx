// @deno-types="@types/react"
import React from "react";
// @deno-types="@types/react-dom/client"
import { createRoot } from "react-dom/client";

import "./styles/main.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
