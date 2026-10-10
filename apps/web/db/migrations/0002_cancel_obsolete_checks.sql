-- 현재가 아니게 된 미승인 revision(새 HEAD · close · merge)의 대기 Check를 cancelled로 닫는 의도를 추가한다.
-- 승인된 revision은 success 그대로 보존한다. 기존 행은 모두 새 제약을 만족한다(queued · success만 있었음).

ALTER TABLE revisions DROP CONSTRAINT revisions_desired_check_state_check;
ALTER TABLE revisions ADD CONSTRAINT revisions_desired_check_state_check
  CHECK (desired_check_state IN ('queued', 'success', 'cancelled'));

ALTER TABLE revisions DROP CONSTRAINT revisions_decision_consistent;
ALTER TABLE revisions ADD CONSTRAINT revisions_decision_consistent CHECK (
  (decision = 'pending' AND desired_check_state IN ('queued', 'cancelled')
    AND approver_id IS NULL AND approver_login IS NULL AND decision_at IS NULL)
  OR
  (decision = 'approved' AND desired_check_state = 'success'
    AND approver_id IS NOT NULL AND approver_login IS NOT NULL AND decision_at IS NOT NULL)
);
