import { eq, sql, type SQL } from "drizzle-orm";
import { requireUserId, type AuthenticatedContext } from "@/auth/context";
import {
  appSettings,
  distractions,
  focusIntervals,
  goals,
  sessionPhases,
  sessions,
  tasks,
} from "@/db/schema";

type OwnedTable =
  | typeof goals
  | typeof tasks
  | typeof sessions
  | typeof appSettings
  | typeof distractions
  | typeof sessionPhases
  | typeof focusIntervals;

/** Explicit query predicate; descendants inherit their immutable parent's User. */
export function ownedBy(context: AuthenticatedContext, table: OwnedTable): SQL {
  const userId = requireUserId(context);
  if (table === goals || table === sessions || table === appSettings)
    return eq(table.userId, userId);
  if (table === tasks)
    return sql`exists (select 1 from goals owner_goal where owner_goal.id = ${tasks.goalId} and owner_goal.user_id = ${userId})`;
  const child = table as
    typeof distractions | typeof sessionPhases | typeof focusIntervals;
  return sql`exists (select 1 from sessions owner_session where owner_session.id = ${child.sessionId} and owner_session.user_id = ${userId})`;
}
