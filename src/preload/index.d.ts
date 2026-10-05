import type { StenoApi } from "./index";

declare global {
    interface Window {
        steno: StenoApi;
    }
}
