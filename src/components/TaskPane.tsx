import { Box, Text } from 'ink';
import React, { useEffect, useState } from 'react';
import { Test } from '../test-plan.ts';

interface TaskPaneProps {
  tasks: Test[];
}

const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'completed':
      return '☑️';
    case 'failed':
      return '❌';
    case 'pending':
      return '🔳';
    default:
      return '🔳';
  }
};

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

const TaskPane: React.FC<TaskPaneProps> = ({ tasks }) => {
  const [blinkOn, setBlinkOn] = useState(false);

  useEffect(() => {
    const hasInProgress = tasks.some((task) => task.status === 'in_progress');
    if (!hasInProgress) {
      setBlinkOn(false);
      return;
    }

    const interval = setInterval(() => {
      setBlinkOn((prev) => !prev);
    }, 500);

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
          const scenarioColor = inProgress ? 'white' : 'dim';
          const scenarioDimmed = inProgress ? blinkOn : false;

          return (
            <Box key={taskIndex} flexDirection="row" marginY={0}>
              <Text>{getStatusIcon(task.status)}</Text>
              <Text> {getPriorityIcon(task.priority)}</Text>
              <Text color={scenarioColor} dimColor={scenarioDimmed} wrap="truncate-end">
                {' '}
                {task.scenario}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default TaskPane;
