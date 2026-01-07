import { Box, Text } from 'ink';
import React, { useEffect, useState } from 'react';
import { Test } from '../test-plan.ts';

interface TaskPaneProps {
  tasks: Test[];
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

const TaskPane: React.FC<TaskPaneProps> = React.memo(({ tasks }) => {
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

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box borderStyle="round" borderColor="dim" padding={1} flexDirection="column">
        <Box justifyContent="space-between" marginBottom={1}>
          <Text color="dim">📋 Testing Tasks</Text>
          <Text color="dim">[{tasks.length} total]</Text>
        </Box>

        {tasks.map((task: Test, taskIndex) => {
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
            <Box key={taskIndex} flexDirection="row" marginY={0}>
              <Text> {getPriorityIcon(task.priority)}</Text>
              <Text color={taskColor} strikethrough={strikethrough} wrap="truncate-end">
                {' '}
                {task.scenario}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});

export default TaskPane;
