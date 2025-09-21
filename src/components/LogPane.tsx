import React, { useState, useCallback, useEffect } from 'react';
import dedent from 'dedent';
import { marked } from 'marked';
// import markedTerminal from 'marked-terminal';

import { Box, Text } from 'ink';
import type { TaggedLogEntry, LogType } from '../utils/logger.js';
import { registerLogPane, setVerboseMode, unregisterLogPane } from '../utils/logger.js';

// marked.use(new markedTerminal());

type LogEntry = string | React.ReactElement | TaggedLogEntry;

interface LogPaneProps {
  verboseMode: boolean;
}

const LogPane: React.FC<LogPaneProps> = ({ verboseMode }) => {
  const [logs, setLogs] = useState<(string | TaggedLogEntry)[]>([]);

  const addLog = useCallback((logEntry: string | TaggedLogEntry) => {
    setLogs((prevLogs) => {
      if (prevLogs.length > 0) {
        const lastLog = prevLogs[prevLogs.length - 1];
        if (
          typeof lastLog === 'string' &&
          typeof logEntry === 'string' &&
          lastLog === logEntry
        ) {
          return prevLogs;
        }
        if (
          typeof lastLog === 'object' &&
          'type' in lastLog &&
          typeof logEntry === 'object' &&
          'type' in logEntry &&
          lastLog.type === logEntry.type &&
          lastLog.content === logEntry.content
        ) {
          return prevLogs;
        }
      }
      return [...prevLogs.slice(-50), logEntry];
    });
  }, []);

  useEffect(() => {
    registerLogPane(addLog);

    return () => {
      unregisterLogPane(addLog);
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
      default:
        return {};
    }
  };

  const processLogContent = (content: string): string[] => {
    return content.split('\n').filter((line) => line.length > 0);
  };

  const renderLogEntry = (log: LogEntry, index: number) => {
    if (typeof log === 'object' && 'type' in log && 'content' in log) {
      const taggedLog = log as TaggedLogEntry;

      // Skip debug logs when not in verbose mode
      if (taggedLog.type === 'debug' && !verboseMode) {
        return null;
      }
      const styles = getLogStyles(taggedLog.type);

      if (taggedLog.type === 'multiline') {
        return (
          <Box key={index} flexDirection="column">
            <Text>{marked.parse(String(taggedLog.content)).toString()}</Text>
          </Box>
        );
      }

      const lines = processLogContent(String(taggedLog.content));

      if (taggedLog.type === 'substep') {
        return (
          <Box key={index} flexDirection="column">
            {lines.map((line, lineIndex) => (
              <Text key={`${index}-${lineIndex}`} {...styles}>
                {lineIndex === 0 ? `> ${line}` : `   ${line}`}
              </Text>
            ))}
          </Box>
        );
      }

      if (taggedLog.type === 'step') {
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

      return (
        <Box key={index} flexDirection="column">
          {lines.map((line, lineIndex) => (
            <Text key={`${index}-${lineIndex}`} {...styles}>
              {line}
            </Text>
          ))}
        </Box>
      );
    }

    if (typeof log === 'string') {
      const lines = processLogContent(log);
      return (
        <Box key={index} flexDirection="column">
          {lines.map((line, lineIndex) => (
            <Text key={`${index}-${lineIndex}`}>{line}</Text>
          ))}
        </Box>
      );
    }

    return <Box key={index}>{log}</Box>;
  };

  return (
    <Box flexDirection="column">
      {logs.map((log, index) => renderLogEntry(log, index)).filter(Boolean)}
    </Box>
  );
};

export default LogPane;
