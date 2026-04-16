import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserHistory } from "@tanstack/react-router";

import "./index.css";

import { getRouter } from "./router";

const router = getRouter(createBrowserHistory());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
