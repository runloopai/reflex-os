// PluginServices augmentation for plugin-workstation.
// This file declares plugin-provided services on the shared PluginServices interface.
// Uses the concrete type because provider plugins need to return their actual implementation.
import '@reflex/plugin-api/plugin-services';
import type { WorkstationRegistryService } from './server/workstation-registry.service.js';

declare module '@reflex/plugin-api' {
  interface PluginServices {
    workstationRegistry?: WorkstationRegistryService;
  }
}
