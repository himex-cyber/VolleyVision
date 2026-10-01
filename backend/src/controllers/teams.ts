import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma, runSerializable } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../lib/audit';
import { syncOwnerMembership } from '../services/teamMembership.service';
import { generateTeamJoinCode } from '../services/teamJoinCode.service';
import { assertRoomForAnotherTeam } from '../services/teamOwnership.service';
import { isGlobalAdmin, seesEveryPlayer, canManageMembers, Permission, roleHasPermission } from '../services/permission.service';
import { maskOtherUserIds, maskOwner } from '../lib/playerPrivacy';
import { removeStoredFiles } from '../lib/storageCleanup';
import { SNAPSHOT_MARKER, REMOVED_WITH_TEAM } from '../lib/messageReport';

const ownerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

export async function getTeams(req: Request, res: Response, next: NextFunction) {
  try {
    // Teams are private to their members:
    //  - anonymous:          nothing
    //  - logged-in non-admin: teams they own or are a member of
    //  - admin:               all teams (support/debugging affordance)
    const userId = req.user?.userId ?? null;
    if (!userId) {
      res.json([]);
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });

    const where: Prisma.TeamWhereInput =
      user?.role === 'ADMIN'
        ? {}
        : { OR: [{ ownerId: userId }, { memberships: { some: { userId } } }] };

    const teams = await prisma.team.findMany({
      where,
      include: {
        _count: { select: { players: true, matches: true } },
        owner: { select: ownerSelect },
      },
      orderBy: { name: 'asc' },
    });
    // Per team (9.0.2): one membership read for the whole list, not one per team.
    const roles = new Map((await prisma.teamMembership.findMany({
      where: { userId, teamId: { in: teams.map((t) => t.id) } },
      select: { teamId: true, role: true },
    })).map((m) => [m.teamId, m.role]));
    res.json(teams.map((t) => {
      const role = roles.get(t.id);
      return maskOwner(t, !!role && roleHasPermission(role, Permission.MANAGE_MEMBERS), userId);
    }));
  } catch (err) {
    next(err);
  }
}

export async function getTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const team = await prisma.team.findUnique({
      where: { id: req.params.id },
      include: {
        players: { orderBy: { jerseyNumber: 'asc' } },
        matches: { orderBy: { matchDate: 'desc' }, take: 10 },
        owner: { select: ownerSelect },
      },
    });
    if (!team) throw new AppError(404, 'Team not found.');
    const callerId = req.user?.userId ?? null;
    const canManage = callerId ? await canManageMembers(callerId, team.id) : false;
    res.json(maskOwner({ ...team, players: maskOtherUserIds(team.players, await seesEveryPlayer(callerId, team.id), callerId) }, canManage, callerId));
  } catch (err) {
    next(err);
  }
}

export async function createTeam(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Authentication required.');

    // Anyone can create a team and becomes its coach (Phase 4.5): what you can
    // do is decided per team by your role there, never by signupIntent. Limits
    // instead: teamCreateRateLimit, and at most MAX_OWNED_TEAMS owned teams.
    const { name, division, season } = req.body;
    if (!name || !season) throw new AppError(400, 'Team name and season are required.');

    // The creator owns the team. This is what makes Team.ownerId safe to be
    // non-nullable — every team has an owner from the moment it exists.
    // The nested create gives every team its single TEAM chat channel in the
    // same transaction (getOrCreateTeamChannel self-heals if it's ever missing).
    // Every team also gets its reusable player/staff join codes at birth.
    const userId = req.user.userId;
    const [playerJoinCode, staffJoinCode, isAdmin] = await Promise.all([
      generateTeamJoinCode('PLAYER'), generateTeamJoinCode('STAFF'), isGlobalAdmin(userId),
    ]);
    const team = await runSerializable(async (tx) => {
      await assertRoomForAnotherTeam(tx, userId, isAdmin);
      return tx.team.create({
        data: {
          name,
          division,
          season,
          ownerId: userId,
          playerJoinCode,
          staffJoinCode,
          channels: { create: { type: 'TEAM' } },
        },
        include: { owner: { select: ownerSelect } },
      });
    });
    // Give the owner a HEAD_COACH membership so team-scoped reads and the
    // permission checks see them immediately.
    await syncOwnerMembership(team.id, req.user.userId);

    logAudit(req.user.userId, 'CREATE_TEAM', 'team', team.id);
    res.status(201).json(team);
  } catch (err) {
    next(err);
  }
}

// Create and update return the owner unmasked: only the owner creates, and
// MANAGE_TEAM (head coach, manager) implies MANAGE_MEMBERS.
export async function updateTeam(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, division, season } = req.body;
    const team = await prisma.team.update({
      where: { id: req.params.id },
      data: { name, division, season },
      include: { owner: { select: ownerSelect } },
    });
    if (req.user) logAudit(req.user.userId, 'UPDATE_TEAM', 'team', team.id);
    res.json(team);
  } catch (err) {
    next(err);
  }
}

export async function deleteTeam(req: Request, res: Response, next: NextFunction) {
  try {
    // 9.0.8: the cascade drops the attachment rows, so read the file paths from
    // the database first (listing the bucket isn't recursive and pages at 100).
    const files = await prisma.messageAttachment.findMany({
      where: { message: { channel: { teamId: req.params.id } } },
      select: { storagePath: true },
    });
    // Reports about the team's messages have no FK to them (they outlive a
    // removed message), so blank their copies here: deleting a team erases its
    // chat, reports included. The reason and time stay.
    await prisma.$transaction([
      prisma.$executeRaw`
        UPDATE feedback SET description = regexp_replace(description, ${SNAPSHOT_MARKER + '\n'} || '.*$', ${SNAPSHOT_MARKER + '\n' + REMOVED_WITH_TEAM})
        WHERE type = 'MESSAGE_REPORT' AND reported_message_id IN (
          SELECT m.id FROM messages m JOIN channels c ON c.id = m.channel_id WHERE c.team_id = ${req.params.id})`,
      prisma.team.delete({ where: { id: req.params.id } }),
    ]);
    await removeStoredFiles(files.map((f) => f.storagePath));
    if (req.user) logAudit(req.user.userId, 'DELETE_TEAM', 'team', req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
