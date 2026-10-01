-- Host erasure guards are available in composed deployments. Standalone plugin
-- test databases have no users/secrets tables. The host refuses erasure if any
-- declared personal table lacks its guard (including an older host upgrade).
DO $migration$
BEGIN
  IF to_regprocedure('reflex_guard_erased_user()') IS NOT NULL THEN
    CREATE TRIGGER workstation_tool_calls_user_id_erasure_guard BEFORE INSERT OR UPDATE ON workstation_tool_calls
FOR EACH ROW EXECUTE FUNCTION reflex_guard_erased_user('user_id');
    CREATE TRIGGER workstations_user_id_erasure_guard BEFORE INSERT OR UPDATE ON workstations
FOR EACH ROW EXECUTE FUNCTION reflex_guard_erased_user('user_id');
  END IF;
END;
$migration$;
