import { hostname } from 'node:os';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useCallback, useRef, useState } from 'react';
import { DEFAULT_BASE_URL, type TuiConfig } from '../config.js';
import {
  DeviceAuthAbortError,
  startDeviceAuth,
  waitForDeviceToken,
} from '../connect/device-auth.js';
import { openBrowser } from '../connect/open-browser.js';

interface LoginAppProps {
  /**
   * Server offered when the user submits an empty URL field. The CLI
   * resolves this as `--url` > `REFLEX_BASE_URL` > the hosted instance.
   */
  initialBaseUrl?: string;
  /** Called with the validated config; the host saves it and continues. */
  onComplete: (config: TuiConfig) => void;
  onCancel: () => void;
}

type Step =
  | { name: 'url' }
  | { name: 'starting' }
  | {
      name: 'waiting';
      verificationUri: string;
      verificationUriComplete: string;
      userCode: string;
      opened: boolean;
    }
  | { name: 'error'; message: string };

function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, '');
  const candidate = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * First-run login wizard: confirm the server, then run the browser-based
 * "connect link" (device-authorization) flow. The CLI opens/prints a short
 * URL, the user approves in the web app and picks an org there, and the CLI
 * receives a freshly minted personal API key — no key pasting. The org is
 * chosen in the browser, so there is no in-terminal org picker.
 */
export function LoginApp({ initialBaseUrl, onComplete, onCancel }: LoginAppProps) {
  const { exit } = useApp();
  const defaultBaseUrl = initialBaseUrl ?? DEFAULT_BASE_URL;
  const [step, setStep] = useState<Step>({ name: 'url' });
  const [baseUrl, setBaseUrl] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const finish = useCallback(
    (config: TuiConfig) => {
      onComplete(config);
      exit();
    },
    [onComplete, exit],
  );

  const beginFlow = useCallback(
    async (url: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStep({ name: 'starting' });
      try {
        const start = await startDeviceAuth(url, hostname());
        const opened = openBrowser(start.verificationUriComplete);
        setStep({
          name: 'waiting',
          verificationUri: start.verificationUri,
          verificationUriComplete: start.verificationUriComplete,
          userCode: start.userCode,
          opened,
        });
        const result = await waitForDeviceToken(url, start.deviceCode, {
          intervalSeconds: start.interval,
          signal: controller.signal,
        });
        if (result.status === 'approved') {
          finish({ baseUrl: url, apiKey: result.apiKey, organizationId: result.organizationId });
          return;
        }
        if (result.status === 'denied') {
          setStep({ name: 'error', message: 'The request was denied in the browser.' });
          return;
        }
        setStep({
          name: 'error',
          message: 'This connect link expired before it was approved.',
        });
      } catch (err) {
        if (err instanceof DeviceAuthAbortError) return;
        const message = err instanceof Error ? err.message : String(err);
        setStep({ name: 'error', message: `Could not reach ${url}: ${message}` });
      }
    },
    [finish],
  );

  useInput((_input, key) => {
    if (key.escape) {
      abortRef.current?.abort();
      onCancel();
      exit();
      return;
    }
    if (step.name === 'error' && key.return) {
      const url = normalizeBaseUrl(baseUrl);
      if (url) void beginFlow(url);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Connect to Reflex
      </Text>

      <Box gap={1} marginTop={1}>
        <Text color={step.name === 'url' ? 'cyan' : 'green'}>
          {step.name === 'url' ? '❯' : '✓'}
        </Text>
        <Text>Server: </Text>
        {step.name === 'url' ? (
          <TextInput
            value={baseUrl}
            onChange={setBaseUrl}
            onSubmit={(value) => {
              const candidate = value.trim() || defaultBaseUrl;
              const url = normalizeBaseUrl(candidate);
              if (url) {
                setBaseUrl(candidate);
                void beginFlow(url);
              }
            }}
            placeholder={defaultBaseUrl}
          />
        ) : (
          <Text dimColor>{normalizeBaseUrl(baseUrl)}</Text>
        )}
      </Box>
      {step.name === 'url' ? (
        <Text dimColor>{'  '}enter accepts the default · type a URL for self-hosted</Text>
      ) : null}

      {step.name === 'starting' ? <Text color="yellow">opening your browser…</Text> : null}

      {step.name === 'waiting' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {step.opened
              ? 'Approve the connection in your browser.'
              : 'Open this URL in your browser to approve:'}
          </Text>
          <Text color="cyan">
            {'  '}
            {step.verificationUriComplete}
          </Text>
          <Text>
            {'  '}Confirmation code: <Text bold>{step.userCode}</Text>
          </Text>
          <Box marginTop={1}>
            <Text color="yellow">waiting for approval… </Text>
            <Text dimColor>esc to cancel</Text>
          </Box>
        </Box>
      ) : null}

      {step.name === 'error' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">{step.message}</Text>
          <Text dimColor>enter to retry · esc to quit</Text>
        </Box>
      ) : null}

      {step.name === 'url' ? (
        <Box marginTop={1}>
          <Text dimColor>esc quit</Text>
        </Box>
      ) : null}
    </Box>
  );
}
