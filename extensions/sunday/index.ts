import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { sundayDock, sundayPlugin } from "./src/channel.js";
import { handleSundayWebhookRequest } from "./src/monitor.js";
import { setSundayRuntime } from "./src/runtime.js";

const plugin = {
  id: "sunday",
  name: "Sunday",
  description: "Sunday messaging platform channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setSundayRuntime(api.runtime);
    api.registerChannel({ plugin: sundayPlugin, dock: sundayDock });
    api.registerHttpHandler(handleSundayWebhookRequest);
  },
};

export default plugin;
