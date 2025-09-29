import React from 'react';
import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { addActivityListener, removeActivityListener, type ActivityEntry } from '../activity.ts';

const ActivityPane: React.FC = () => {
  const [activity, setActivity] = useState<ActivityEntry | null>(null);
  const [animationState, setAnimationState] = useState(0);

  useEffect(() => {
    const listener = (newActivity: ActivityEntry | null) => {
      setActivity(newActivity);
    };

    addActivityListener(listener);

    return () => {
      removeActivityListener(listener);
    };
  }, []);

  useEffect(() => {
    if (!activity) return;

    const interval = setInterval(() => {
      setAnimationState((prev) => (prev + 1) % 4);
    }, 500);

    return () => clearInterval(interval);
  }, [activity]);

  if (!activity) {
    return (
      <Box height={1} paddingX={1}>
        <Text dimColor>Done. Press [ESC] to enable input</Text>
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

  const getDots = () => {
    return '.'.repeat(animationState);
  };

  const isDimmed = animationState % 2 === 0;

  return (
    <Box height={1} marginY={1} paddingX={1}>
      <Text color={getActivityColor(activity.type)} dimColor={isDimmed}>
        {activity.message}
        {getDots()}
      </Text>
    </Box>
  );
};

export default ActivityPane;
