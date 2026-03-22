import { Box, Text } from 'ink';
import React from 'react';

const MAX_VISIBLE_PLANS = 2;

interface PlanPaneProps {
  completedPlans: PlanSummary[];
  activePlan: PlanSummary | null;
}

const PlanPane: React.FC<PlanPaneProps> = React.memo(({ completedPlans, activePlan }) => {
  if (!activePlan && completedPlans.length === 0) return null;

  const collapsedCount = Math.max(0, completedPlans.length - MAX_VISIBLE_PLANS);
  const collapsedTests = completedPlans.slice(0, collapsedCount).reduce((sum, p) => sum + p.testCount, 0);
  const visiblePlans = completedPlans.slice(collapsedCount);

  return (
    <Box flexDirection="row" width="100%" paddingX={1}>
      <Box flexGrow={1} flexShrink={1} flexDirection="row" overflow="hidden">
        {collapsedCount > 0 && (
          <>
            <Text backgroundColor="blue" color="white" wrap="truncate-end">
              +{collapsedCount} plans ({collapsedTests} tests)
            </Text>
            <Text backgroundColor="blue" color="white">
              {' '}
              │{' '}
            </Text>
          </>
        )}
        {visiblePlans.map((plan, i) => (
          <React.Fragment key={i}>
            <Text backgroundColor="blue" color="gray" wrap="truncate-end">
              {plan.title} ({formatStats(plan)})
            </Text>
            <Text backgroundColor="blue" color="gray">
              {' '}
              ›{' '}
            </Text>
          </React.Fragment>
        ))}
      </Box>

      {activePlan && (
        <Box flexShrink={0}>
          <Text backgroundColor="blue" color="white" bold>
            {activePlan.title} ({activePlan.testCount} tests)
          </Text>
        </Box>
      )}
    </Box>
  );
});

function formatStats(plan: PlanSummary): string {
  const parts: string[] = [];
  if (plan.passed > 0) parts.push(`${plan.passed}✓`);
  if (plan.failed > 0) parts.push(`${plan.failed}✗`);
  if (parts.length === 0) return `${plan.testCount} tests`;
  return parts.join(' ');
}

export default PlanPane;

export interface PlanSummary {
  title: string;
  testCount: number;
  passed: number;
  failed: number;
}
