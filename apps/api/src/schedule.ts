import { CronExpressionParser } from 'cron-parser';

export function nextCronDate(expression: string, timezone: string, from = new Date()): Date {
  const parsed = CronExpressionParser.parse(expression, {
    currentDate: from,
    tz: timezone || 'UTC',
  });
  return parsed.next().toDate();
}
