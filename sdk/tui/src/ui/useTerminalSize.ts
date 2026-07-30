import { useStdout } from 'ink';
import { useEffect, useState } from 'react';

export interface TerminalSize {
  columns: number;
  rows: number;
}

const FALLBACK: TerminalSize = { columns: 80, rows: 24 };

/** Current terminal dimensions, updating live on resize. */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const read = (): TerminalSize => ({
    columns: stdout?.columns ?? FALLBACK.columns,
    rows: stdout?.rows ?? FALLBACK.rows,
  });
  const [size, setSize] = useState<TerminalSize>(read);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () =>
      setSize({ columns: stdout.columns ?? FALLBACK.columns, rows: stdout.rows ?? FALLBACK.rows });
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return size;
}
