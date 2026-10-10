-- 009 rollback: restores the previous claim_invite (INSECURE: trusts p_user_id).
-- Use only if invites break and you need time to fix. Re-apply 009 afterwards.
CREATE OR REPLACE FUNCTION public.claim_invite(p_code text, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invite RECORD;
BEGIN
  SELECT * INTO v_invite
  FROM   public.team_invites
  WHERE  invite_code = p_code
    AND  status      = 'pending'
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Invite not found or already used.');
  END IF;

  IF v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('success', false,
      'error', 'This invite has expired. Ask your admin to resend it.');
  END IF;

  INSERT INTO public.users (id, organisation_id, name, email, role, active)
  VALUES (
    p_user_id,
    v_invite.organisation_id,
    split_part(v_invite.email, '@', 1),
    v_invite.email,
    v_invite.role,
    true
  )
  ON CONFLICT (id) DO UPDATE
    SET organisation_id = EXCLUDED.organisation_id,
        role            = EXCLUDED.role,
        active          = true;

  UPDATE public.team_invites
  SET    status     = 'claimed',
         claimed_at = now()
  WHERE  id = v_invite.id;

  INSERT INTO public.team_members (organisation_id, user_id, role, invited_by)
  VALUES (v_invite.organisation_id, p_user_id, v_invite.role, v_invite.invited_by)
  ON CONFLICT (organisation_id, user_id)
    DO UPDATE SET role = EXCLUDED.role, updated_at = now();

  INSERT INTO public.team_members_audit
    (organisation_id, user_id, action, new_value, changed_by)
  VALUES (
    v_invite.organisation_id,
    p_user_id,
    'added',
    jsonb_build_object('role', v_invite.role, 'via', 'invite_code'),
    v_invite.invited_by
  );

  RETURN jsonb_build_object(
    'success',         true,
    'organisation_id', v_invite.organisation_id,
    'role',            v_invite.role
  );
END;
$function$;
-- Note: the anon revoke from 009 stays in place; it was not part of the original state.