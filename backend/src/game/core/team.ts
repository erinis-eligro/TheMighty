/**
 * Whether `otherId` is known to be on `viewerId`'s team, using only information the viewer has.
 *
 * The owner team is the president plus the friend. The friend stays hidden until revealed:
 * - the president and the (still hidden) friend only know the revealed owner team members
 *   (the friend always knows the president);
 * - opposition players learn the teams from the public reveal. A reveal without a friend
 *   means everybody but the president is opposition. Before the reveal they know only themselves.
 */
export function isAlly({
  viewerId,
  otherId,
  ownerPlayerId,
  friendPlayerId,
  friendRevealed,
  viewerIsFriend,
}: {
  viewerId: string;
  otherId: string;
  ownerPlayerId: string;
  /** Only set once the friend was revealed. */
  friendPlayerId?: string;
  friendRevealed: boolean;
  /** Server-side knowledge: the viewer holds the friend role (even if not revealed yet). */
  viewerIsFriend: boolean;
}): boolean {
  if (viewerId === otherId) return true;

  const isKnownOwnerTeam = (id: string) =>
    id === ownerPlayerId || (friendPlayerId !== undefined && id === friendPlayerId);

  if (viewerId === ownerPlayerId || viewerIsFriend) {
    return isKnownOwnerTeam(otherId);
  }
  return friendRevealed ? !isKnownOwnerTeam(otherId) : false;
}
