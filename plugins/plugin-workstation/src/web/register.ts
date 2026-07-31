import { MonitorSmartphone } from 'lucide-react';
import { createWebRegistrationFromManifest } from '@reflex/plugin-api/create-web-registration';
import { workstationWeb } from '../web-manifest.js';

export default createWebRegistrationFromManifest(
  workstationWeb,
  {
    WorkstationAttachmentPicker: () => import('./WorkstationAttachmentPicker'),
    WorkstationAttachmentSummary: () => import('./WorkstationAttachmentSummary'),
    WorkstationMentionProvider: () => import('./WorkstationMentionProvider'),
    WorkstationToolCallView: () => import('./WorkstationToolCallView'),
    WorkstationAgentBadge: () => import('./WorkstationAgentBadge'),
    WorkstationAgentSection: () => import('./WorkstationAgentSection'),
    WorkstationsPage: () => import('./WorkstationsPage'),
  },
  {
    icons: { MonitorSmartphone },
  },
);
