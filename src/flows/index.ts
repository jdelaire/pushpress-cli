import { FlowDefinition } from '../types';
import { loginFlow } from './login.flow';
import { workoutHistoryFlow } from './workout-history.flow';
import { workoutWeekFlow } from './workout-week.flow';
import { scheduleBookFlow } from './schedule-book.flow';

export const flows: FlowDefinition[] = [
  loginFlow,
  workoutHistoryFlow,
  workoutWeekFlow,
  scheduleBookFlow,
];

export function getFlow(name: string): FlowDefinition | undefined {
  return flows.find((flow) => flow.name === name);
}
