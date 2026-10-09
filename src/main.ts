import { createApp } from "vue";
import { createRouter, createWebHashHistory } from "vue-router";
import ui from "@nuxt/ui/vue-plugin";
import { addCollection } from "@iconify/vue";
import { icons } from "@iconify-json/lucide";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App.vue";
import "./style.css";
import "./product.css";

document.body.dataset.window = getCurrentWebviewWindow().label;

addCollection(icons);

createApp(App)
  .use(createRouter({history:createWebHashHistory(),routes:[{path:"/:pathMatch(.*)*",component:{render:()=>null}}]}))
  .use(ui)
  .mount("#app");
