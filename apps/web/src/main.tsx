/** The web app's entry point, which Vite builds from index.html. See mount.tsx. */
import "./index.css";

import { mountApp } from "./mount";

mountApp(window, import.meta.env);
