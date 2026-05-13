import dedent from 'dedent';
import React from 'react';
import { useCallback, useEffect, useState } from 'react';
import stripAnsi from 'strip-ansi';
import { htmlTextSnapshot } from '../utils/html.js';
import { parseMarkdownToTerminal } from '../utils/markdown-terminal.js';

import { Box, Text } from 'ink';
import type { LogType, TaggedLogEntry } from '../utils/logger.js';
import { isDebugMode, registerLogPane, unregisterLogPane } from '../utils/logger.js';

// marked.use(new markedTerminal());

type LogEntry = TaggedLogEntry & { collapsedCount?: number };

interface LogPaneProps {
  verboseMode: boolean;
}

const LogPane: React.FC<LogPaneProps> = React.memo(({ verboseMode }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const pendingLogsRef = React.useRef<LogEntry[]>([]);
  const flushTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const MAX_MULTILINE_LINES = 16;
  const MAX_STEP_LINES = 8;
  const MAX_SUBSTEP_LINES = 6;

  const formatCollapsedContent = (lines: string[], collapsedCount: number, label: string) => {
    if (collapsedCount <= 0) {
      return lines.join('\n');
    }
    return [`... ${collapsedCount} earlier ${label}`, ...lines].join('\n');
  };

  const flushLogs = useCallback(() => {
    if (pendingLogsRef.current.length === 0) return;

    const newLogs = pendingLogsRef.current;
    pendingLogsRef.current = [];
    flushTimeoutRef.current = null;

    setLogs((prevLogs: LogEntry[]) => {
      const result = [...prevLogs];

      for (const logEntry of newLogs) {
        if (result.length === 0) {
          result.push(logEntry);
          continue;
        }

        const lastLog = result[result.length - 1];
        if (lastLog.type === logEntry.type && lastLog.content === logEntry.content && Math.abs((lastLog.timestamp?.getTime() || 0) - (logEntry.timestamp?.getTime() || 0)) < 1000) {
          continue;
        }

        if ((logEntry.type === 'step' || logEntry.type === 'substep') && lastLog.type === logEntry.type && Math.abs((lastLog.timestamp?.getTime() || 0) - (logEntry.timestamp?.getTime() || 0)) < 1500) {
          const currentLines = String(logEntry.content)
            .split('\n')
            .filter((line) => line.length > 0);
          const previousLines = String(lastLog.content)
            .split('\n')
            .filter((line) => line.length > 0);
          const visiblePreviousLines = lastLog.collapsedCount ? previousLines.slice(1) : previousLines;
          const maxLines = logEntry.type === 'step' ? MAX_STEP_LINES : MAX_SUBSTEP_LINES;
          const mergedLines = [...visiblePreviousLines, ...currentLines];
          const overflow = Math.max(0, mergedLines.length - maxLines);
          const collapsedCount = (lastLog.collapsedCount || 0) + overflow;
          const visibleLines = mergedLines.slice(-maxLines);
          const label = logEntry.type === 'step' ? 'steps' : 'details';
          result[result.length - 1] = {
            ...lastLog,
            content: formatCollapsedContent(visibleLines, collapsedCount, label),
            timestamp: logEntry.timestamp,
            collapsedCount,
          };
          continue;
        }

        result.push(logEntry);
      }

      return result;
    });
  }, []);

  const addLog = useCallback(
    (logEntry: TaggedLogEntry) => {
      pendingLogsRef.current.push(logEntry);

      if (!flushTimeoutRef.current) {
        flushTimeoutRef.current = setTimeout(flushLogs, 150);
      }
    },
    [flushLogs]
  );

  useEffect(() => {
    registerLogPane(addLog);

    return () => {
      unregisterLogPane(addLog);
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
      }
    };
  }, [addLog]);
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
      case 'step':
        return { color: 'cyan' as const, dimColor: true };
      case 'multiline':
        return { color: 'gray' as const, dimColor: true };
      case 'html':
        return { color: 'gray' as const };
      case 'input':
        return { bold: true, color: '#FFA500' };
      default:
        return {};
    }
  };

  const processLogContent = (content: string): string[] => {
    return content.split('\n').filter((line) => line.length > 0);
  };

  const renderLogEntry = (log: TaggedLogEntry, index: number) => {
    // Skip debug logs when not in verbose mode AND DEBUG env var is not set
    const shouldShowDebug = verboseMode || isDebugMode() || Boolean(process.env.DEBUG?.includes('explorbot:')) || process.env.DEBUG === '*';
    if (log.type === 'debug' && !shouldShowDebug) {
      return null;
    }
    const styles = getLogStyles(log.type);

    if (log.type === 'multiline') {
      const cleaned = stripAnsi(dedent(log.content));
      const parsed = parseMarkdownToTerminal(cleaned);
      const lines = parsed.split('\n');
      const truncated =
        lines.length > MAX_MULTILINE_LINES ? `${lines.slice(0, MAX_MULTILINE_LINES).join('\n')}\n... (${lines.length - MAX_MULTILINE_LINES} more lines)` : parsed;
      return (
        <Box key={index} borderStyle="classic" borderLeft={false} borderRight={false} marginY={1} padding={1} borderColor="dim" overflow="hidden">
          <Text color="gray" dimColor>
            {truncated}
          </Text>
        </Box>
      );
    }

    if (log.type === 'html') {
      // Convert HTML to markdown, then render as multiline
      const markdown = htmlTextSnapshot(log.content);
      const multilineLog: TaggedLogEntry = {
        type: 'multiline',
        content: `HTML Content:\n\n${markdown}`,
        timestamp: log.timestamp,
      };

      return renderLogEntry(multilineLog, index);
    }

    const lines = processLogContent(String(log.content));

    if (log.type === 'substep') {
      return (
        <Box key={index} marginLeft={2} flexDirection="column">
          {lines.map((line, lineIndex) => (
            <Text key={`${index}-${lineIndex}`} {...styles}>
              {lineIndex === 0 ? `> ${line}` : `   ${line}`}
            </Text>
          ))}
        </Box>
      );
    }

    if (log.type === 'step') {
      return (
        <Box key={index} flexDirection="column" paddingLeft={2}>
          {lines.map((line, lineIndex) => (
            <Text key={`${index}-${lineIndex}`} {...styles}>
              {line}
            </Text>
          ))}
        </Box>
      );
    }

    let marginTop = 0;
    if (log.type === 'info') marginTop = 1;
    const icon = log.type === 'info' ? '◉' : log.type === 'success' ? '✓' : log.type === 'error' ? '✗' : log.type === 'warning' ? '!' : log.type === 'debug' ? '*' : '';

    return (
      <Box key={index} columnGap={1} marginTop={marginTop} flexDirection="row">
        {icon && <Text {...styles}>{icon}</Text>}
        <Box flexDirection="column">
          {lines.map((line, lineIndex) => (
            <Text key={`${index}-${lineIndex}`} {...styles}>
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    );
  };

  const maxLogs = 100;
  const visibleLogs = logs.length > maxLogs ? logs.slice(-maxLogs) : logs;
  return <Box flexDirection="column">{visibleLogs.map((log, index) => renderLogEntry(log, index)).filter(Boolean)}</Box>;
});

export default LogPane;
