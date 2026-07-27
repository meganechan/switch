/*
 Delete leaked / misidentified sessions (CHOO-1440 follow-up).

 A session used to freeze its agent identity as a name tag in `config`
 (`agentName`, legacy `subagentName`) while its `agent_id` was written to the
 location's representative (plain) agent rather than the definition-backed agent
 it actually ran as. Identity is now resolved authoritatively from
 `session.agent_id -> agents.definition_name` (the sidebar groups by agent_id;
 the notification poller reads its credentials from the joined agent row). Every
 tagged session therefore points at the wrong agent and can no longer be
 repaired from the tag alone — and some point at a definition whose agent row no
 longer exists at all (the invisible "ghost" sessions).

 A one-shot wipe of the tagged rows is the sanctioned fix (approved: losing the
 existing sessions is acceptable). Auto-start and manual launch recreate them
 under the correct agent id. Plain-agent sessions carry no tag and already hold
 the correct agent_id, so they are left untouched.
*/
DELETE FROM `sessions`
WHERE json_extract(`config`, '$.agentName') IS NOT NULL
   OR json_extract(`config`, '$.subagentName') IS NOT NULL;
