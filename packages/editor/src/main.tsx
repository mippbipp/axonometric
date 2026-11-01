import "./index.css";
import { Option } from "effect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import { readInlineState } from "./inline-state.ts";
import { LiveApp } from "./live-app.tsx";
import { connectLive, readServedPage } from "./live-store.ts";

const root = document.querySelector("#root");

if (root !== null) {
  const inline = readInlineState(document);
  const served = readServedPage(document);

  const page = (() => {
    if (!inline.ok) {
      return <p className="p-4 font-mono">{inline.message}</p>;
    }

    // Only a page that serve served connects. The read-only file has no
    // server to talk to.
    return Option.match(served, {
      onNone: () => <App state={inline.state} />,
      onSome: (where) => (
        <LiveApp
          store={connectLive({ initial: inline.state, served: where })}
        />
      ),
    });
  })();

  createRoot(root).render(<StrictMode>{page}</StrictMode>);
}
