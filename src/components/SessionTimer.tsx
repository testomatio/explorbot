import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

type SessionTimerProps = {
  startedAt: number;
};

const pad = (n: number) => String(n).padStart(2, '0');

const SessionTimer: React.FC<SessionTimerProps> = ({ startedAt }) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(id);
  }, []);

  const diffSec = Math.floor((now - startedAt) / 1000);
  const seconds = diffSec % 60;
  const minutes = Math.floor(diffSec / 60) % 60;
  const hours = Math.floor(diffSec / 3600);

  return (
    <Box borderStyle="round" paddingX={1} paddingY={0}>
      <Text>
        Session time: {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </Text>
    </Box>
  );
};

export default SessionTimer;
