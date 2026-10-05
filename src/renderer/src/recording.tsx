import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RecordingPill } from "./components/RecordingPill";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <RecordingPill />
    </StrictMode>
);
