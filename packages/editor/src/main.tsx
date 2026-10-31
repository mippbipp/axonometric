import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import { readInlineState } from "./inline-state.ts";

const root = document.querySelector("#root");

if (root !== null) {
  const inline = readInlineState(document);

  createRoot(root).render(
    <StrictMode>
      {inline.ok ? (
        <App state={inline.state} />
      ) : (
        <p className="p-4 font-mono">{inline.message}</p>
      )}
    </StrictMode>
  );
}
