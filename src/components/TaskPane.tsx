import { Box, Text } from 'ink';
import React, { useEffect, useState } from 'react';
import { Test } from '../test-plan.ts';

const WINDOW_SIZE = 7;

interface TaskPaneProps {
  tasks: Test[];
  scrollOffset?: number;
}

const getPriorityIcon = (priority: string): string => {
  switch (priority.toLowerCase()) {
    case 'high':
      return '⭆';
    case 'medium':
      return '⇒';
    case 'low':
      return '⇝';
    default:
      return '⇢';
  }
};

const TaskPane: React.FC<TaskPaneProps> = React.memo(({ tasks, scrollOffset = 0 }) => {
  const [blinkOn, setBlinkOn] = useState(false);

  useEffect(() => {
    const hasInProgress = tasks.some((task) => task.status === 'in_progress');
    if (!hasInProgress) {
      setBlinkOn(false);
      return;
    }

    const interval = setInterval(() => {
      setBlinkOn((prev) => !prev);
    }, 1500);

    return () => {
      clearInterval(interval);
    };
  }, [tasks]);

  const completedCount = tasks.filter((t) => t.hasFinished).length;
  const currentIteration = Math.max(0, ...tasks.map((t) => t.planIteration));
  const visibleTasks = tasks.filter((t) => t.enabled);

  const aboveCount = scrollOffset;
  const belowCount = Math.max(0, visibleTasks.length - scrollOffset - WINDOW_SIZE);
  const windowTasks = visibleTasks.slice(scrollOffset, scrollOffset + WINDOW_SIZE);

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box borderStyle="round" borderColor="dim" padding={1} flexDirection="column">
        <Box justifyContent="space-between" marginBottom={1}>
          <Text color="dim">📋 Tests</Text>
          <Box>
            <Text color="dim" bold>
              Ctrl+E
            </Text>
            <Text color="dim"> edit </Text>
            <Text color="dim">
              [{completedCount}/{tasks.length}]
            </Text>
          </Box>
        </Box>

        {aboveCount > 0 && (
          <Text color="dim">
            {'  '}▲ {aboveCount} more
          </Text>
        )}

        {windowTasks.map((task: Test, windowIndex) => {
          const globalIndex = scrollOffset + windowIndex;
          const inProgress = task.status === 'in_progress';
          let taskColor = 'dim';
          let strikethrough = false;

          if (task.isSuccessful) {
            taskColor = 'green';
            strikethrough = true;
          } else if (task.hasFailed) {
            taskColor = 'red';
          } else if (inProgress) {
            taskColor = blinkOn ? 'white' : 'dim';
          }

          return (
            <Box key={task.id || globalIndex} flexDirection="row" marginY={0}>
              <Text> {getPriorityIcon(task.priority)}</Text>
              <Text color={taskColor} strikethrough={strikethrough} wrap="truncate-end">
                {' '}
                {globalIndex + 1}. {task.scenario}
              </Text>
            </Box>
          );
        })}

        {belowCount > 0 && (
          <Text color="dim">
            {'  '}▼ {belowCount} more
          </Text>
        )}
      </Box>
    </Box>
  );
});

export default TaskPane;
