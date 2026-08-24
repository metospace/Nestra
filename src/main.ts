import { createApp } from "vue";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App.vue";
import "./style.css";

document.body.dataset.window = getCurrentWebviewWindow().label;

createApp(App)
  .use(PrimeVue, {
    theme: { preset: Aura },
    options: { darkModeSelector: ".dark" },
  })
  .mount("#app");

// The desktop layer participates in the dark token scheme everywhere.
document.documentElement.classList.add("dark");
