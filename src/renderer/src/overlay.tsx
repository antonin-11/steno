import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Overlay } from "./components/Overlay";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <Overlay />
    </StrictMode>
);
