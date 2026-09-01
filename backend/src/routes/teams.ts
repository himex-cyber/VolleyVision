import { Router } from 'express';
import { getTeams, getTeam, createTeam, updateTeam, deleteTeam } from '../controllers/teams';
import { myTeams, transferTeam, teamOwner } from '../controllers/teamOwnership';
import { listMembers, createMember, updateMember, deleteMember } from '../controllers/teamMembership';
import { createTeamInvitation, listTeamInvitations } from '../controllers/invitation';
import { listTeamJoinCodes, regenerateTeamJoinCode } from '../controllers/teamJoinCode';
import { listTeamApprovalRequests } from '../controllers/approval';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { requireTeamPermission, requireTeamAccess } from '../middleware/permissions';
import { visibleByTeamParam } from '../middleware/visibility';
import { Permission, getUserTeamRole, getEffectivePermissions } from '../services/permission.service';

const router = Router();

// Named routes first (must come before /:id to avoid conflict)
router.get('/my-teams', requireAuth, myTeams);

// Standard CRUD — every team-scoped read is gated by membership visibility.
// optionalAuth is kept on the list/detail reads so an anonymous caller gets an
// empty list / 404 rather than a hard 401.
router.get('/', optionalAuth, getTeams);
router.get('/:id', optionalAuth, visibleByTeamParam('id'), getTeam);
router.post('/', requireAuth, createTeam);
router.patch('/:id', requireAuth, requireTeamPermission(Permission.MANAGE_TEAM), updateTeam);
router.delete('/:id', requireAuth, requireTeamPermission(Permission.MANAGE_TEAM), deleteTeam);

// My role on this team — used by the frontend PermissionGuard.
// `permissions` folds per-member access tiers over the role map, so the UI
// gates match backend enforcement (e.g. a Statistician granted invitation
// access sees the Invite control).
router.get('/:id/my-role', requireAuth, async (req, res, next) => {
  try {
    const { role, isOwner } = await getUserTeamRole(req.user!.userId, req.params.id);
    const permissions = await getEffectivePermissions(req.user!.userId, req.params.id);
    res.json({ role, isOwner, permissions });
  } catch (err) {
    next(err);
  }
});

// Ownership actions
router.get('/:id/owner', optionalAuth, visibleByTeamParam('id'), teamOwner);
router.post('/:id/transfer', requireAuth, requireTeamPermission(Permission.TRANSFER_OWNERSHIP), transferTeam);

// Membership management
router.get('/:id/members', optionalAuth, visibleByTeamParam('id'), listMembers);
router.post('/:id/members',   requireAuth, requireTeamPermission(Permission.MANAGE_MEMBERS), createMember);
router.patch('/:id/members/:memberId', requireAuth, requireTeamPermission(Permission.MANAGE_MEMBERS), updateMember);
router.delete('/:id/members/:memberId', requireAuth, requireTeamPermission(Permission.MANAGE_MEMBERS), deleteMember);

// Invitation management. Sending is tiered (Iteration 3) — gated on the member's
// invitation access tier, not the static INVITE_USERS role permission.
router.get('/:id/invitations',  requireAuth, requireTeamAccess('invitation', 'id'), listTeamInvitations);
router.post('/:id/invitations', requireAuth, requireTeamAccess('invitation', 'id'), createTeamInvitation);

// Reusable team join codes — viewing and regenerating share the invitation
// access category (regenerate additionally requires FULL_ACCESS in-controller).
router.get('/:id/join-codes', requireAuth, requireTeamAccess('invitation', 'id'), listTeamJoinCodes);
router.post('/:id/join-codes/regenerate', requireAuth, requireTeamAccess('invitation', 'id'), regenerateTeamJoinCode);

// Approval queue — list is head-coach/owner only (MANAGE_TEAM = head coach)
router.get('/:id/approval-requests', requireAuth, requireTeamPermission(Permission.MANAGE_TEAM), listTeamApprovalRequests);

export default router;
