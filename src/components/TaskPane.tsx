import { Box, Text } from 'ink';
import React from 'react';
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
      return '▢';
    default:
      return '⮽';
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

const getPriorityColor = (priority: string): string => {
  switch (priority.toLowerCase()) {
    case 'high':
      return 'red';
    case 'medium':
      return 'redBright';
    case 'low':
      return 'yellow';
    default:
      return 'dim';
  }
};

const TaskPane: React.FC<TaskPaneProps> = ({ tasks }) => {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box borderStyle="round" borderColor="dim" padding={1} flexDirection="column">
        <Box justifyContent="space-between" marginBottom={1}>
          <Text color="dim">📋 Testing Tasks</Text>
          <Text color="dim">[{tasks.length} total]</Text>
        </Box>

        {tasks.map((task: Test, taskIndex) => (
          <Box key={taskIndex} flexDirection="row" marginY={0}>
            <Text>{getStatusIcon(task.status)}</Text>
            <Text color={getPriorityColor(task.priority)}> {getPriorityIcon(task.priority)}</Text>
            <Text color="dim" wrap="truncate-end">
              {' '}
              ({task.scenario})
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default TaskPane;
