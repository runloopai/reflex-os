import { describePluginContract } from '@reflex/plugin-api/test';
import { workstationPlugin } from '../index.js';
import webRegistration from '../web/register.js';

describePluginContract(workstationPlugin, { webRegistration });
