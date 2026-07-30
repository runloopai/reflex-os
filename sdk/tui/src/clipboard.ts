import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * Read an image off the system clipboard, the way Claude Code's terminal
 * ctrl+v works: shell out to the platform clipboard tool and hand back PNG
 * bytes. Returns null when the clipboard has no image (or no tool exists) —
 * callers surface that as a notice, never an error.
 */

const run = promisify(execFile);

/** Buffer cap for clipboard reads; the shared attachment limits enforce the real maximum. */
const MAX_CLIPBOARD_BYTES = 64 * 1024 * 1024;

/**
 * `osascript -e 'the clipboard as «class PNGf»'` prints the image as an
 * AppleScript data literal: `«data PNGf89504E47…»` (hex after the type tag).
 */
export function parseOsascriptPngHex(stdout: string): Buffer | null {
  const match = /«data PNGf([0-9A-Fa-f]+)»/.exec(stdout);
  if (!match) return null;
  const bytes = Buffer.from(match[1], 'hex');
  return bytes.length > 0 ? bytes : null;
}

export async function readClipboardImage(
  platform: NodeJS.Platform = process.platform,
): Promise<Buffer | null> {
  try {
    if (platform === 'darwin') {
      // Errors with "can't make ... into type" when the clipboard holds no image.
      const { stdout } = await run('osascript', ['-e', 'the clipboard as «class PNGf»'], {
        maxBuffer: MAX_CLIPBOARD_BYTES,
      });
      return parseOsascriptPngHex(stdout);
    }

    if (platform === 'linux') {
      // Wayland first, then X11; whichever tool exists and has image content wins.
      const candidates: Array<[string, string[]]> = [
        ['wl-paste', ['--type', 'image/png']],
        ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']],
      ];
      for (const [command, args] of candidates) {
        try {
          const { stdout } = await run(command, args, {
            maxBuffer: MAX_CLIPBOARD_BYTES,
            encoding: 'buffer',
          });
          if (stdout.length > 0) return stdout;
        } catch {
          // tool missing or clipboard has no image — try the next one
        }
      }
      return null;
    }

    if (platform === 'win32') {
      const script =
        'Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ' +
        '$img=[System.Windows.Forms.Clipboard]::GetImage(); ' +
        'if($img -ne $null){$ms=New-Object System.IO.MemoryStream; ' +
        '$img.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); ' +
        '[Convert]::ToBase64String($ms.ToArray())}';
      const { stdout } = await run('powershell', ['-NoProfile', '-STA', '-Command', script], {
        maxBuffer: MAX_CLIPBOARD_BYTES,
      });
      const b64 = stdout.trim();
      return b64 ? Buffer.from(b64, 'base64') : null;
    }
  } catch {
    return null;
  }
  return null;
}
