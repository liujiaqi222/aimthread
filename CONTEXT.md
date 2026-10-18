# AimThread

A personal, AI-native goal execution and time accounting system designed to help users start, track progress, and seamlessly resume work.

## Language

### Ownership

**User**:
An individual with a private set of Goals, Tasks, Sessions, preferences, and AI authorizations in AimThread. Different Users do not share execution data or a current execution context.
_Avoid_: Instance owner, Team, Workspace, Tenant

**Login Identity**:
A Google or GitHub identity through which an individual accesses their AimThread User. Multiple Login Identities with the same verified email can belong to one User when both the existing User email and incoming identity email are verified.
_Avoid_: User, Workspace, AI authorization

### Planning

**Goal**:
The overarching desired outcome or intention a user wants to achieve. Every execution session must belong to an active Goal.
_Avoid_: Project, Aim, Target, Milestone, Track

**Task**:
A concrete, actionable step created under a Goal to advance it. A Goal may contain zero or more Tasks.
_Avoid_: Todo, Action item, Subgoal, Issue

### Execution

**Session**:
A single continuous execution workflow or manual time record tied to a Goal and optionally to a Task. For pomodoro timers, multiple focus and break intervals belong to the same Session.
_Avoid_: Pomodoro, Run, Focus record, Log entry, Work unit

**Focus Interval**:
A contiguous half-open time interval `[start, end)` representing actual focused effort within a Session. Excludes breaks, pauses, or idle time awaiting next steps.
_Avoid_: Focus segment, Chunk, Period

**Timer Mode**:
The timing style chosen for a Session, currently supporting Stopwatch (count-up) and Pomodoro (structured focus and break intervals).
_Avoid_: Clock type, Timer style

**Entry Mode**:
How a Session was created, distinguishing live timer runs (`timer`) from retroactive manual entries (`manual`).
_Avoid_: Source, Input type, Record mode

**Intent**:
A brief statement of immediate focus written before starting a Session when no formal Task is selected. Belongs to the Session and does not generate a Task.
_Avoid_: Session goal, Quick task, Purpose, Plan

**Resume Hint**:
A brief prompt left at the end of a Session indicating where to pick up next time. Displayed on the execution dashboard to facilitate immediate continuation.
_Avoid_: Next step, Memo, Review summary, Future note, Handoff

**Distraction**:
A brief note logged during an active Session capturing an interruption or wandering thought.
_Avoid_: Interruption, Noise, Tangent

### Reflection

**Footprint**:
The historical record and visual calendar of actual time invested in Goals over time.
_Avoid_: Contribution graph, Activity log, Habit streak, Statistics dashboard
