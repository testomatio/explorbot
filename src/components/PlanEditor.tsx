import { Box, Text, useInput } from 'ink';
import React, { useEffect, useState } from 'react';
import type { Test } from '../test-plan.ts';

const EDITOR_WINDOW = 12;

interface PlanEditorProps {
  tasks: Test[];
  onClose: () => void;
  isActive: boolean;
}

const PlanEditor: React.FC<PlanEditorProps> = ({ tasks, onClose, isActive }) => {
  const [cursorIndex, setCursorIndex] = useState(0);
  const [enabledMap, setEnabledMap] = useState<boolean[]>([]);

  useEffect(() => {
    setEnabledMap(tasks.map((t) => t.enabled));
    setCursorIndex(0);
  }, [tasks]);

  useInput(
    (input, key) => {
      if (key.upArrow) {
        setCursorIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setCursorIndex((prev) => Math.min(tasks.length - 1, prev + 1));
        return;
      }
      if (input === ' ') {
        setEnabledMap((prev) => {
          const next = [...prev];
          next[cursorIndex] = !next[cursorIndex];
          return next;
        });
        return;
      }
      if (input === 'a') {
        setEnabledMap(tasks.map(() => true));
        return;
      }
      if (input === 'n') {
        setEnabledMap(tasks.map(() => false));
        return;
      }
      if (key.delete && tasks[cursorIndex]?.plan) {
        tasks[cursorIndex].plan.removeTest(tasks[cursorIndex]);
        setCursorIndex((prev) => Math.min(prev, tasks.length - 2));
        return;
      }
      if (key.return) {
        for (let i = 0; i < tasks.length; i++) {
          tasks[i].enabled = enabledMap[i];
        }
        tasks[0]?.plan?.notifyChange();
        onClose();
        return;
      }
      if (key.escape) {
        onClose();
      }
    },
    { isActive }
  );

  if (!isActive) return null;

  const scrollStart = Math.max(0, Math.min(cursorIndex - Math.floor(EDITOR_WINDOW / 2), tasks.length - EDITOR_WINDOW));
  const scrollEnd = Math.min(tasks.length, scrollStart + EDITOR_WINDOW);
  const visibleSlice = tasks.slice(scrollStart, scrollEnd);

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Edit Plan
        </Text>
        <Text color="dim"> — </Text>
        <Text color="dim">(</Text>
        <Text bold>↑↓</Text>
        <Text color="dim">)</Text>
        <Text color="dim"> navigate </Text>
        <Text color="dim">(</Text>
        <Text bold>Space</Text>
        <Text color="dim">)</Text>
        <Text color="dim"> toggle </Text>
        <Text color="dim">(</Text>
        <Text bold>a</Text>
        <Text color="dim">)</Text>
        <Text color="dim"> all </Text>
        <Text color="dim">(</Text>
        <Text bold>n</Text>
        <Text color="dim">)</Text>
        <Text color="dim"> none </Text>
        <Text color="dim">(</Text>
        <Text bold>Del</Text>
        <Text color="dim">)</Text>
        <Text color="dim"> remove </Text>
        <Text color="dim">(</Text>
        <Text bold>Enter</Text>
        <Text color="dim">)</Text>
        <Text color="dim"> confirm </Text>
        <Text color="dim">(</Text>
        <Text bold>Esc</Text>
        <Text color="dim">)</Text>
        <Text color="dim"> cancel</Text>
      </Box>

      {scrollStart > 0 && (
        <Text color="dim">
          {'  '}▲ {scrollStart} more
        </Text>
      )}

      {visibleSlice.map((task, i) => {
        const globalIdx = scrollStart + i;
        const isCursor = globalIdx === cursorIndex;
        const isEnabled = enabledMap[globalIdx];
        const checkbox = isEnabled ? '[x]' : '[ ]';
        const cursor = isCursor ? '>' : ' ';
        const color = isEnabled ? 'green' : 'dim';

        return (
          <Box key={task.id || globalIdx} flexDirection="row">
            <Text color={isCursor ? 'yellow' : 'dim'}>{cursor} </Text>
            <Text color={color}>
              {checkbox} {globalIdx + 1}. {task.scenario}
            </Text>
          </Box>
        );
      })}

      {scrollEnd < tasks.length && (
        <Text color="dim">
          {'  '}▼ {tasks.length - scrollEnd} more
        </Text>
      )}

      <Box marginTop={1}>
        <Text color="dim">
          {enabledMap.filter(Boolean).length}/{tasks.length} enabled
        </Text>
      </Box>
    </Box>
  );
};

export default PlanEditor;
