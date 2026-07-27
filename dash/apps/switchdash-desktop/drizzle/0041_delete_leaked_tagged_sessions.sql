/*
 Delete leaked / misidentified sessions (CHOO-1440 follow-up).

 A session used to freeze its agent identity as a name tag in `config`
 (`agentName`, legacy `subagentName`) while its `agent_id` was written to the
 wrong agent — the location's representative agent instead of the definition it
 actually ran as. Identity is now resolved authoritatively from
 `session.agent_id -> agents.definition_name` (the sidebar groups by agent_id;
 the notification poller reads its credentials from the joined agent row), so a
 session whose frozen tag disagrees with its owning agent's definition points at
 the wrong agent and cannot be repaired from the tag alone. Some point at a
 definition whose agent row no longer exists at all — the invisible "ghosts".

 Delete exactly those diverged rows: a tag that does NOT equal the owning agent's
 `definition_name`. A healthy session — created under the right agent, whose tag
 was derived from that same `definition_name` — has tag == definition_name and is
 kept, so live auto-started sessions are not churned. Untagged sessions are kept.
 The wiped rows recreate under the correct agent id on next launch / auto-start.
*/
DELETE FROM `sessions`
WHERE COALESCE(json_extract(`config`, '$.agentName'), json_extract(`config`, '$.subagentName')) IS NOT NULL
  AND COALESCE(json_extract(`config`, '$.agentName'), json_extract(`config`, '$.subagentName'))
    IS NOT (SELECT `definition_name` FROM `agents` WHERE `agents`.`id` = `sessions`.`agent_id`);
