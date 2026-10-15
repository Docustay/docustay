-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- P8.8 — TWO CORRECTIONS TO 0110/0112, BOTH FOUND BY THE GATE RATHER THAN BY READING.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ 1 · AN UPDATE'S **NEW** ROW MUST SATISFY THE **SELECT** POLICY, NOT ONLY THE UPDATE POLICY'S
--         `WITH CHECK`. This is the correction, and it is the kind of thing that is obvious only
--         after it costs you an hour.
--
--     0112 gave the sweep a SELECT policy for `state = 'sent' AND expires_at <= now()` and an UPDATE
--     policy whose `WITH CHECK` is `state = 'expired'`. Every clause was satisfied and the UPDATE was
--     still refused:
--
--       [EXECUTED as app_rw, tenant set, no user]
--         SELECT count(*) … WHERE id = <the row>                    →  1      (visible)
--         UPDATE keystone.document_instance SET state='expired' …   →  ERROR 42501
--                "new row violates row-level security policy for table \"document_instance\""
--
--   ★★ PROVEN BY BISECTION RATHER THAN GUESSED. Setting the UPDATE policy's `WITH CHECK` to `true`
--      did NOT fix it; widening the SELECT policy to admit `expired` DID, immediately. **The row
--      after the update has to be visible under the SELECT policies, or the write is refused** —
--      and the sweep's own read policy, being exactly the rows it wants to CHANGE, excluded the
--      result of changing them. A policy that describes a transition must admit BOTH ends of it.
--
--   ★ The widening is small and worth stating plainly: an unviewered caller may now also read
--     documents that are already `expired` and overdue. Those are lapsed, unsigned requests — never
--     an executed instrument, never a partially-signed one, never a live one. The alternative was a
--     SECURITY DEFINER escape, which is a far bigger hole for a far smaller reason.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ★★★ 2 · `expired_shape` DID NOT ACTUALLY PROTECT `partially_signed`, WHICH IS THE ONE STATE
--         0110's OWN RULING WAS WRITTEN TO PROTECT.
--
--     0110 says a clock must never void something a person has signed, and backed it with
--       CHECK (state <> 'expired' OR (expires_at IS NOT NULL AND executed_at IS NULL
--                                     AND template_snapshot IS NULL))
--     A `partially_signed` row has no `executed_at` and no `template_snapshot` — **so it satisfies
--     that CHECK completely.** The constraint stops `executed → expired` and stops nothing else. A
--     CHECK cannot see the previous state, so it was never capable of expressing the rule.
--   ★★ The `executed` case was already covered anyway, and not by me: the U25 immutability trigger
--      refuses ANY change to an executed instrument, with a message that tells you to void and
--      reissue. So the CHECK was protecting the one state that was already safe and missing the one
--      that was not.
--   ★★★ THE RULE IS ABOUT A TRANSITION, SO IT IS ENFORCED BY A TRIGGER. `sent → expired` and nothing
--       else. Not "the sweep only looks at sent rows" — that is a predicate in one module, and this
--       project's recurring lesson is that a rule living in one predicate is a rule the next careless
--       write removes.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

ALTER POLICY system_expiry_read ON keystone.document_instance
  USING (tenant_id = keystone.current_tenant_id()
         AND keystone.current_user_id() IS NULL
         -- ★ BOTH ENDS OF THE TRANSITION. `sent` is what the sweep looks for; `expired` is what it
         --   leaves behind, and without it the write it is allowed to make is refused.
         AND state IN ('sent', 'expired')
         AND expires_at IS NOT NULL
         AND expires_at <= now()
         AND archived_at IS NULL);

CREATE OR REPLACE FUNCTION keystone.document_only_sent_may_lapse()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state = 'expired' AND OLD.state <> 'expired' AND OLD.state <> 'sent' THEN
    RAISE EXCEPTION
      'a % document cannot be expired — only a SENT one may lapse (P8.8). A clock must not void an '
      'instrument somebody has already signed: that needs a person, and the act is to VOID it and '
      'say why, which is recorded. To stop chasing it, void it.', OLD.state
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION keystone.document_only_sent_may_lapse() IS
  'P8.8. Enforces the transition rule a CHECK cannot express: expired is reachable ONLY from sent. partially_signed is the state this exists for — it satisfies expired_shape (no executed_at, no snapshot) and must still never be expired by a clock.';

DROP TRIGGER IF EXISTS document_only_sent_may_lapse ON keystone.document_instance;
CREATE TRIGGER document_only_sent_may_lapse
  BEFORE UPDATE ON keystone.document_instance
  FOR EACH ROW
  -- ★ Only fires on a row actually becoming expired, so it costs nothing on every other write.
  WHEN (NEW.state = 'expired' AND OLD.state IS DISTINCT FROM 'expired')
  EXECUTE FUNCTION keystone.document_only_sent_may_lapse();
