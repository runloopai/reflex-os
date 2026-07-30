import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { highlightCode } from '../chat/highlight.js';
import { inlineWidth, parseMarkdown, type Block, type InlineNode } from '../chat/markdown.js';

interface MarkdownProps {
  children: string;
}

/**
 * Renders a block of agent Markdown as styled Ink output. Blocks are stacked in
 * a column with one blank line between them, so headings, lists, and tables get
 * breathing room instead of colliding the way raw source does.
 */
export function Markdown({ children }: MarkdownProps) {
  const blocks = parseMarkdown(children);
  if (blocks.length === 0) return null;
  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => (
        <Box key={i} marginTop={i === 0 ? 0 : 1} flexDirection="column">
          <BlockView block={block} />
        </Box>
      ))}
    </Box>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading':
      return (
        <Text bold color={block.level <= 2 ? 'cyan' : undefined}>
          {renderInline(block.inline)}
        </Text>
      );

    case 'paragraph':
      return <Text wrap="wrap">{renderInline(block.inline)}</Text>;

    case 'hr':
      return <Text dimColor>{'─'.repeat(24)}</Text>;

    case 'quote':
      return (
        <Box
          borderStyle="single"
          borderColor="gray"
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          paddingLeft={1}
        >
          <Text dimColor italic wrap="wrap">
            {renderInline(block.inline)}
          </Text>
        </Box>
      );

    case 'code': {
      const highlighted = highlightCode(block.lines, block.lang);
      return (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          paddingLeft={1}
        >
          {block.lang ? <Text dimColor>{block.lang}</Text> : null}
          {highlighted.map((spans, i) => (
            <Text key={i}>
              {spans.length === 0
                ? ' '
                : spans.map((span, j) => (
                    <Text key={j} color={span.color} dimColor={span.dim}>
                      {span.text}
                    </Text>
                  ))}
            </Text>
          ))}
        </Box>
      );
    }

    case 'list':
      return (
        <Box flexDirection="column">
          {block.items.map((item, i) => (
            <Box key={i} marginLeft={item.depth * 2}>
              <Text color="gray">{item.ordinal !== null ? `${item.ordinal}. ` : '• '}</Text>
              <Box flexGrow={1}>
                <Text wrap="wrap">{renderInline(item.inline)}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      );

    case 'table':
      return <TableView block={block} />;
  }
}

function TableView({ block }: { block: Extract<Block, { type: 'table' }> }) {
  const cols = block.header.length;
  const widths = new Array<number>(cols).fill(0);
  const measure = (cells: InlineNode[][]) => {
    for (let c = 0; c < cols; c++) {
      widths[c] = Math.max(widths[c], inlineWidth(cells[c] ?? []));
    }
  };
  measure(block.header);
  block.rows.forEach(measure);

  const cell = (nodes: InlineNode[] | undefined, c: number, bold: boolean) => (
    <Box key={c} width={widths[c] + 2}>
      <Text bold={bold} wrap="truncate-end">
        {renderInline(nodes ?? [])}
      </Text>
    </Box>
  );

  return (
    <Box flexDirection="column">
      <Box>{block.header.map((h, c) => cell(h, c, true))}</Box>
      <Text dimColor>{widths.map((w) => '─'.repeat(w + 1)).join(' ')}</Text>
      {block.rows.map((row, r) => (
        <Box key={r}>{row.map((cellNodes, c) => cell(cellNodes, c, false))}</Box>
      ))}
    </Box>
  );
}

function renderInline(nodes: InlineNode[], keyPrefix = 'i'): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case 'text':
        return node.value;
      case 'code':
        return (
          <Text key={key} color="cyan">
            {node.value}
          </Text>
        );
      case 'strong':
        return (
          <Text key={key} bold>
            {renderInline(node.children, key)}
          </Text>
        );
      case 'em':
        return (
          <Text key={key} italic>
            {renderInline(node.children, key)}
          </Text>
        );
      case 'strike':
        return (
          <Text key={key} strikethrough>
            {renderInline(node.children, key)}
          </Text>
        );
      case 'link':
        return (
          <Text key={key} underline color="blue">
            {renderInline(node.label, key)}
          </Text>
        );
    }
  });
}
