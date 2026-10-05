import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
    main: {},
    preload: {},
    renderer: {
        plugins: [react(), tailwindcss()],
        build: {
            rollupOptions: {
                // Une page par fenêtre : la fenêtre principale, la pastille de correction et la pilule d'enregistrement
                input: {
                    index: resolve("src/renderer/index.html"),
                    overlay: resolve("src/renderer/overlay.html"),
                    recording: resolve("src/renderer/recording.html"),
                },
            },
        },
    },
});
