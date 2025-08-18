import React from 'react';
import { Box, Text } from 'ink';
import type { TaggedLogEntry, LogType } from '../utils/logger.js';

type LogEntry = string | React.ReactElement | TaggedLogEntry;

interface LogPaneProps {
  logs: LogEntry[];
  maxLines?: number; // alias for maxRows
  maxRows?: number;
  maxColumns?: number;
}

const LogPane: React.FC<LogPaneProps> = ({
  logs,
  maxLines,
  maxRows,
  maxColumns,
}) => {
  const getLogStyles = (type: LogType) => {
    switch (type) {
      case 'success':
        return { color: 'green' as const };
      case 'error':
        return { color: 'red' as const };
      case 'warning':
        return { color: 'yellow' as const };
      case 'debug':
        return { color: 'gray' as const, dimColor: true };
      case 'substep':
        return { color: 'gray' as const, dimColor: true };
      case 'multiline':
        return { color: 'gray' as const, dimColor: true };
      default:
        return {};
    }
  };

  const renderLogEntry = (log: LogEntry, index: number) => {
    // Handle tagged log entries
    if (typeof log === 'object' && 'type' in log && 'content' in log) {
      const taggedLog = log as TaggedLogEntry;
      const styles = getLogStyles(taggedLog.type);

      if (taggedLog.type === 'multiline') {
        const content = String(taggedLog.content);
        const lines = content.split('\n');
        const maxLines = 5;
        const trimmedLines = lines.slice(0, maxLines);
        const wasTrimmed = lines.length > maxLines;

        return (
          <Box key={index} flexDirection="column">
            {trimmedLines.map((line, lineIndex) => (
              <Text key={`${index}-${lineIndex}`} {...styles}>
                {lineIndex === 0 ? line : `   ${line}`}
              </Text>
            ))}
            {wasTrimmed && (
              <Text key={`${index}-ellipsis`} {...styles}>
                ...
              </Text>
            )}
          </Box>
        );
      }

      if (taggedLog.type === 'debug') {
        return (
          <Text key={index} {...styles}>
            {taggedLog.content}
          </Text>
        );
      }

      if (taggedLog.type === 'substep') {
        return (
          <Text key={index} {...styles}>
            {'> '}
            {taggedLog.content}
          </Text>
        );
      }

      // Default tagged log rendering
      return (
        <Text key={index} {...styles}>
          {String(taggedLog.content)}
        </Text>
      );
    }

    // Handle legacy string and React element logs
    if (typeof log === 'string') {
      return <Text key={index}>{log}</Text>;
    }
    return <Box key={index}>{log}</Box>;
  };

  // Convert logs into plain lines respecting maxColumns, then slice last N rows
  const effectiveRows =
    (maxRows && maxRows > 0 ? maxRows : undefined) ??
    (maxLines && maxLines > 0 ? maxLines : undefined);

  if (!effectiveRows || !maxColumns || maxColumns <= 4) {
    const entries = maxLines && maxLines > 0 ? logs.slice(-maxLines) : logs;
    return <Box flexDirection="column">{entries.map(renderLogEntry)}</Box>;
  }

  const wrapToWidth = (text: string, width: number): string[] => {
    if (width <= 0) return [text];
    const lines: string[] = [];
    const parts = String(text).split('\n');
    for (const part of parts) {
      let start = 0;
      while (start < part.length) {
        lines.push(part.slice(start, start + width));
        start += width;
      }
      if (parts.length > 1) {
        if (part !== parts[parts.length - 1]) {
          // preserve explicit newlines
          if (lines.length === 0 || lines[lines.length - 1] !== '')
            lines.push('');
        }
      }
    }
    return lines.length === 0 ? [''] : lines;
  };

  type StyledLine = { text: string; styles: ReturnType<typeof getLogStyles> };

  const flattenLogsToLines = (): StyledLine[] => {
    const result: StyledLine[] = [];
    const pushStyled = (text: string, styles: StyledLine['styles']) => {
      const wrapped = wrapToWidth(text, maxColumns);
      for (const w of wrapped) result.push({ text: w, styles });
    };

    for (const log of logs) {
      if (typeof log === 'object' && 'type' in log && 'content' in log) {
        const taggedLog = log as TaggedLogEntry;
        const styles = getLogStyles(taggedLog.type);
        if (taggedLog.type === 'multiline') {
          const content = String(taggedLog.content);
          const lines = content.split('\n');
          const maxMultiline = 5;
          const trimmed = lines.slice(0, maxMultiline);
          for (let i = 0; i < trimmed.length; i++) {
            pushStyled(i === 0 ? trimmed[i] : `   ${trimmed[i]}`, styles);
          }
          if (lines.length > maxMultiline) pushStyled('...', styles);
          continue;
        }
        pushStyled(String(taggedLog.content), styles);
        continue;
      }
      if (typeof log === 'string') {
        pushStyled(log, {});
        continue;
      }
      pushStyled(String(log), {});
    }
    return result;
  };

  const allLines = flattenLogsToLines();
  const visible = allLines.slice(-effectiveRows);

  return (
    <Box flexDirection="column">
      {visible.map((line, index) => (
        <Text key={index} {...line.styles}>
          {line.text}
        </Text>
      ))}
    </Box>
  );
};

export default LogPane;
