import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import {
  addActivityListener,
  removeActivityListener,
  type ActivityEntry,
} from '../activity.js';

const ActivityPane: React.FC = () => {
  const [activity, setActivity] = useState<ActivityEntry | null>(null);

  useEffect(() => {
    const listener = (newActivity: ActivityEntry | null) => {
      setActivity(newActivity);
    };

    addActivityListener(listener);

    return () => {
      removeActivityListener(listener);
    };
  }, []);

  if (!activity) {
    return (
      <Box height={1} paddingX={1}>
        <Text dimColor>Ready</Text>
      </Box>
    );
  }

  const getActivityColor = (type: ActivityEntry['type']) => {
    switch (type) {
      case 'ai':
        return 'cyan';
      case 'action':
        return 'green';
      case 'navigation':
        return 'blue';
      default:
        return 'yellow';
    }
  };

  return (
    <Box height={1} paddingX={1}>
      <Text color={getActivityColor(activity.type)}>{activity.message}</Text>
    </Box>
  );
};

export default ActivityPane;
